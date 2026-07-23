/**
 * js-doc-markup — collaborative PDF markup between browser windows.
 *
 * A PDF (served from a g7 bucket) is rendered in the browser (pdf.js); any
 * number of windows join a shared 3-letter session and mark it up together:
 *
 *   - brush tool: draw / circle / highlight on any page, replicated live
 *   - text tool: click to place a text note; typing streams live to everyone
 *   - live cursors: see where the other windows are pointing, per page
 *
 * Sessions: visiting `/` creates a fresh 3-letter code and redirects to
 * `/s/<code>`; other windows join by entering the code (or opening the URL).
 * All annotations are scoped to the session.
 *
 * Abuse control: every session's annotations are deleted 15 minutes after
 * that session's last edit (lazy sweep on page loads and stream opens).
 *
 * State model (same pattern as js-live-canvas):
 *   - durable  → c3: sessions, strokes, texts
 *   - ephemeral→ isolate-global Map: cursors (zero DB writes)
 *   - delivery → SSE + in-memory wake counters: writes are pushed to viewers
 *     on the same edge within ~25ms; a 250ms c3 re-check covers the other
 *     edge (cursors are in-memory, i.e. same-edge only).
 *
 * Routes:
 *   GET  /                 — create a session, redirect to /s/<code>
 *   GET  /s/<code>         — the markup UI for a session
 *   GET  /doc.pdf          — the PDF, streamed from the g7 bucket
 *   GET  /api/events?s=    — SSE: { strokes?, texts?, cursors?, reset? }
 *   POST /api/stroke       — { session, origin, color, page, points }
 *   POST /api/text         — { session, id, origin, color, page, x, y, text }
 *   POST /api/text/delete  — { session, id }
 *   POST /api/cursor       — { session, id, color, page, x, y }  (no DB)
 *   POST /api/clear        — { session } — wipe the session's annotations
 *
 * Coordinates are normalized to the page (x,y ∈ [0,1] of page width/height),
 * so windows of different sizes see annotations in the same document spot.
 */

const PDF_KEY = "nasa-ISSFD23_IN1_4.pdf";
const EXPIRE_MS = 15 * 60 * 1000;

const SCHEMA_SESSIONS = `
  CREATE TABLE IF NOT EXISTS sessions (
    code      TEXT PRIMARY KEY,
    last_edit TEXT NOT NULL
  )`;
const SCHEMA_STROKES = `
  CREATE TABLE IF NOT EXISTS strokes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session    TEXT NOT NULL,
    origin     TEXT NOT NULL,
    color      TEXT NOT NULL,
    page       INTEGER NOT NULL,
    points     TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
const SCHEMA_TEXTS = `
  CREATE TABLE IF NOT EXISTS texts (
    id         TEXT NOT NULL,
    session    TEXT NOT NULL,
    origin     TEXT NOT NULL,
    color      TEXT NOT NULL,
    page       INTEGER NOT NULL,
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    text       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session, id)
  )`;

// Module-global (per-isolate, persists across requests on an edge).
const cursors = new Map(); // "session:id" -> { session, id, color, page, x, y, t }
let cursorSeq = 0;
let strokeSeq = 0;
let textSeq = 0;

const WAKE_MS = 25;
const TICK_MS = 250;
const STREAM_MS = 25_000;
const CURSOR_TTL = 4_000;

export default {
  async fetch(request, env) {
    await env.DB.exec(SCHEMA_SESSIONS);
    await env.DB.exec(SCHEMA_STROKES);
    await env.DB.exec(SCHEMA_TEXTS);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/doc.pdf" && request.method === "GET") {
      const obj = await env.DOCS.get(PDF_KEY);
      if (!obj) return new Response("document missing", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (path === "/api/events" && request.method === "GET") {
      const code = okCode(url.searchParams.get("s"));
      if (!code) return bad("invalid session");
      await sweep(env);
      return eventStream(env, code);
    }

    if (path === "/api/cursor" && request.method === "POST") {
      const { session, id, color, page, x, y } = await request.json();
      const code = okCode(session);
      if (!code || !okId(id) || !okColor(color)) return bad("invalid cursor");
      cursors.set(code + ":" + id, {
        session: code, id, color,
        page: pageNum(page), x: frac(x), y: frac(y), t: Date.now(),
      });
      cursorSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/stroke" && request.method === "POST") {
      const { session, origin, color, page, points } = await request.json();
      const code = okCode(session);
      if (!code || !okId(origin) || !okColor(color)) return bad("invalid stroke");
      if (!Array.isArray(points) || points.length < 2 || points.length > 400) {
        return bad("invalid points");
      }
      const pts = points.map(p => [frac(p[0]), frac(p[1])]);
      await env.DB.prepare(
        "INSERT INTO strokes (session, origin, color, page, points, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(code, origin, color, pageNum(page), JSON.stringify(pts), nowIso()).run();
      await touchSession(env, code);
      strokeSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/text" && request.method === "POST") {
      const { session, id, origin, color, page, x, y, text } = await request.json();
      const code = okCode(session);
      if (!code || !okId(id) || !okId(origin) || !okColor(color)) return bad("invalid text");
      await env.DB.prepare(
        `INSERT INTO texts (id, session, origin, color, page, x, y, text, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session, id) DO UPDATE SET
           x = excluded.x, y = excluded.y, text = excluded.text, updated_at = excluded.updated_at`
      ).bind(id, code, origin, color, pageNum(page), frac(x), frac(y),
             String(text ?? "").slice(0, 4000), nowIso()).run();
      await touchSession(env, code);
      textSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/text/delete" && request.method === "POST") {
      const { session, id } = await request.json();
      const code = okCode(session);
      if (!code || !okId(id)) return bad("invalid delete");
      await env.DB.prepare("DELETE FROM texts WHERE session = ? AND id = ?").bind(code, id).run();
      await touchSession(env, code);
      textSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/clear" && request.method === "POST") {
      const { session } = await request.json();
      const code = okCode(session);
      if (!code) return bad("invalid session");
      await env.DB.prepare("DELETE FROM strokes WHERE session = ?").bind(code).run();
      await env.DB.prepare("DELETE FROM texts WHERE session = ?").bind(code).run();
      await touchSession(env, code);
      strokeSeq++; textSeq++;
      return Response.json({ ok: true });
    }

    const sessMatch = path.match(/^\/s\/([a-zA-Z]{3})$/);
    if (sessMatch && request.method === "GET") {
      const code = sessMatch[1].toLowerCase();
      await sweep(env);
      await env.DB.prepare(
        "INSERT INTO sessions (code, last_edit) VALUES (?, ?) ON CONFLICT (code) DO NOTHING"
      ).bind(code, nowIso()).run();
      return new Response(page(code), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/" && request.method === "GET") {
      await sweep(env);
      const code = await newCode(env);
      return Response.redirect(new URL("/s/" + code, request.url).toString(), 302);
    }

    return new Response("not found", { status: 404 });
  },
};

function bad(msg) { return Response.json({ error: msg }, { status: 400 }); }
function nowIso() { return new Date().toISOString(); }
function okId(s) { return typeof s === "string" && /^[a-z0-9]{1,16}$/.test(s); }
function okColor(s) { return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s); }
function okCode(s) {
  return typeof s === "string" && /^[a-zA-Z]{3}$/.test(s) ? s.toLowerCase() : null;
}
function frac(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1.2, Math.max(-0.2, n)) * 10000) / 10000;
}
function pageNum(v) {
  const n = Math.round(Number(v) || 1);
  return Math.min(2000, Math.max(1, n));
}

async function touchSession(env, code) {
  await env.DB.prepare(
    "INSERT INTO sessions (code, last_edit) VALUES (?, ?) ON CONFLICT (code) DO UPDATE SET last_edit = excluded.last_edit"
  ).bind(code, nowIso()).run();
}

async function newCode(env) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = "";
    for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * letters.length)];
    const { results } = await env.DB.prepare(
      "SELECT code FROM sessions WHERE code = ?"
    ).bind(code).all();
    if (!results.length) {
      await env.DB.prepare("INSERT INTO sessions (code, last_edit) VALUES (?, ?)")
        .bind(code, nowIso()).run();
      return code;
    }
  }
  throw new Error("could not allocate session code");
}

// Delete every session (and its annotations) idle for more than EXPIRE_MS.
async function sweep(env) {
  const cutoff = new Date(Date.now() - EXPIRE_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT code FROM sessions WHERE last_edit < ?"
  ).bind(cutoff).all();
  for (const { code } of results) {
    await env.DB.prepare("DELETE FROM strokes WHERE session = ?").bind(code).run();
    await env.DB.prepare("DELETE FROM texts WHERE session = ?").bind(code).run();
    await env.DB.prepare("DELETE FROM sessions WHERE code = ?").bind(code).run();
    for (const key of cursors.keys()) if (key.startsWith(code + ":")) cursors.delete(key);
    strokeSeq++; textSeq++;
  }
}

function liveCursors(code) {
  const cutoff = Date.now() - CURSOR_TTL;
  const out = [];
  for (const [key, c] of cursors) {
    if (c.t < cutoff) { cursors.delete(key); continue; }
    if (c.session === code) out.push({ id: c.id, color: c.color, page: c.page, x: c.x, y: c.y });
  }
  return out;
}

function eventStream(env, code) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("retry: 500\n\n"));
        let lastStrokeId = 0;
        let seenCursor = -1, seenStroke = -1, seenText = -1;
        let lastCursorPayload = null, lastTextPayload = null, lastTick = 0;
        const deadline = Date.now() + STREAM_MS;
        while (!cancelled && Date.now() < deadline) {
          const t = Date.now();
          const tick = t - lastTick >= TICK_MS;
          const out = {};

          if (cursorSeq !== seenCursor || tick) {
            seenCursor = cursorSeq;
            const payload = JSON.stringify(liveCursors(code));
            if (payload !== lastCursorPayload) {
              lastCursorPayload = payload;
              out.cursors = JSON.parse(payload);
            }
          }

          if (strokeSeq !== seenStroke || tick) {
            seenStroke = strokeSeq;
            const { results: [{ m }] } = await env.DB.prepare(
              "SELECT IFNULL(MAX(id), 0) AS m FROM strokes WHERE session = ?"
            ).bind(code).all();
            if (m < lastStrokeId) { out.reset = true; lastStrokeId = 0; }
            if (m > lastStrokeId) {
              const { results } = await env.DB.prepare(
                "SELECT id, origin, color, page, points FROM strokes WHERE session = ? AND id > ? ORDER BY id"
              ).bind(code, lastStrokeId).all();
              out.strokes = results.map(r => ({
                id: r.id, origin: r.origin, color: r.color,
                page: r.page, points: JSON.parse(r.points),
              }));
              lastStrokeId = m;
            }
          }

          if (textSeq !== seenText || tick) {
            seenText = textSeq;
            const { results } = await env.DB.prepare(
              "SELECT id, origin, color, page, x, y, text FROM texts WHERE session = ? ORDER BY updated_at"
            ).bind(code).all();
            const payload = JSON.stringify(results);
            if (payload !== lastTextPayload) {
              lastTextPayload = payload;
              out.texts = JSON.parse(payload);
            }
          }

          if (tick) lastTick = t;
          if (Object.keys(out).length) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
          }
          await new Promise(r => setTimeout(r, WAKE_MS));
        }
      } catch {
        // client went away or a query failed — just end the stream
      }
      try { controller.close(); } catch {}
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

function page(code) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>doc markup — session ${code.toUpperCase()}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: system-ui, sans-serif; background: #55534e; overflow-x: hidden }
  .topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 10;
    background: #fff; border-bottom: 1px solid #ddd8cc; padding: .5rem .9rem;
    display: flex; align-items: center; gap: .8rem; font-size: .84rem; flex-wrap: wrap }
  .topbar strong { letter-spacing: .01em }
  .code-badge { background: #17141f; color: #fff; border-radius: 7px;
    padding: .25rem .55rem; font-weight: 600; letter-spacing: .12em;
    cursor: pointer; font-size: .8rem }
  .code-badge:hover { background: #33303f }
  .join { display: flex; gap: .3rem; align-items: center }
  .join input { width: 3.6rem; text-transform: uppercase; text-align: center;
    letter-spacing: .12em; padding: .25rem .3rem; border: 1px solid #d5cfc0;
    border-radius: 6px; font-size: .8rem }
  .tools { display: flex; gap: .3rem }
  .tools button, .bar-btn { background: #f4f1e9; border: 1px solid #ddd8cc;
    border-radius: 7px; padding: .3rem .7rem; font-size: .8rem; cursor: pointer; color: #45423a }
  .tools button.active { background: #17141f; color: #fff; border-color: #17141f }
  .swatch { width: 15px; height: 15px; border-radius: 50%; flex: none }
  .hint { color: #97927f; margin-left: auto }
  #doc { padding: 3.4rem 0 3rem; display: flex; flex-direction: column;
    align-items: center; gap: 14px }
  .page { position: relative; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.35) }
  .page canvas { position: absolute; inset: 0; width: 100%; height: 100% }
  .overlay { position: absolute; inset: 0; z-index: 3 }
  canvas.inkc { z-index: 2; pointer-events: none }
  canvas.pdfc { z-index: 1 }
  body.tool-brush .page { cursor: crosshair; touch-action: none }
  body.tool-text .overlay { cursor: text }
  body.tool-brush .textbox { pointer-events: none }
  .textbox { position: absolute; min-width: 150px; max-width: 260px;
    background: rgba(255,253,240,.94); border: 1.5px solid; border-radius: 6px;
    padding: .3rem .45rem; font-size: 13px; font-family: system-ui, sans-serif;
    line-height: 1.35; resize: none; overflow: hidden; z-index: 4;
    box-shadow: 0 1px 5px rgba(0,0,0,.15) }
  .textbox:focus { outline: none; box-shadow: 0 2px 9px rgba(0,0,0,.3) }
  .cursor { position: absolute; left: 0; top: 0; pointer-events: none;
    transition: transform 60ms linear; z-index: 5 }
  .cursor .dot { width: 11px; height: 11px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3) }
  .cursor .tag { margin-top: 2px; font-size: .62rem; color: #fff;
    padding: .06rem .3rem; border-radius: 4px; white-space: nowrap }
  #loading { color: #cfcabb; padding: 5rem 1rem; font-size: .9rem }
</style>
</head>
<body class="tool-brush">
<div class="topbar">
  <strong>doc markup</strong>
  <span class="code-badge" id="codeBadge" title="click to copy link">${code.toUpperCase()}</span>
  <span class="join"><input id="joinInput" maxlength="3" placeholder="ABC">
    <button class="bar-btn" id="joinBtn">Join</button></span>
  <span class="tools">
    <button id="toolBrush" class="active">✏️ Brush</button>
    <button id="toolText">💬 Text</button>
  </span>
  <span class="swatch" id="swatch"></span>
  <button class="bar-btn" id="clearBtn">Clear</button>
  <span class="hint">open this URL in another window to collaborate ·
    edits self-delete 15 min after the last change</span>
</div>
<div id="doc"><div id="loading">loading document…</div></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  var SESSION = ${JSON.stringify(code)};
  var COLORS = ["#e5484d","#f76b15","#d6a514","#30a46c","#00b57e","#3e63dd","#8e4ec6","#e93d82"];
  var ID = Math.random().toString(36).slice(2, 8);
  var COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];
  document.getElementById("swatch").style.background = COLOR;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var doc = document.getElementById("doc");
  var TOOL = "brush";
  var pages = [];          // 1-based: {el, pdfc, inkc, overlay, aspect, rendered, pdfPage}
  var strokesByPage = {};  // page -> [{color, points}]
  var maxSeenStroke = 0;
  var textEls = new Map(); // id -> textarea
  var cursorEls = new Map();
  var pageW = 0;

  function headers() { return { "content-type": "application/json" }; }
  function post(url, body) {
    return fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  }

  // ---------- toolbar ----------
  var brushBtn = document.getElementById("toolBrush");
  var textBtn = document.getElementById("toolText");
  function setTool(t) {
    TOOL = t;
    brushBtn.classList.toggle("active", t === "brush");
    textBtn.classList.toggle("active", t === "text");
    document.body.className = "tool-" + t;
  }
  brushBtn.addEventListener("click", function () { setTool("brush"); });
  textBtn.addEventListener("click", function () { setTool("text"); });

  document.getElementById("codeBadge").addEventListener("click", function () {
    navigator.clipboard.writeText(location.href);
    this.textContent = "COPIED";
    var self = this;
    setTimeout(function () { self.textContent = SESSION.toUpperCase(); }, 900);
  });
  function joinSession() {
    var v = document.getElementById("joinInput").value.trim();
    if (/^[a-zA-Z]{3}$/.test(v)) location.href = "/s/" + v.toLowerCase();
  }
  document.getElementById("joinBtn").addEventListener("click", joinSession);
  document.getElementById("joinInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") joinSession();
  });
  document.getElementById("clearBtn").addEventListener("click", function () {
    post("/api/clear", { session: SESSION });
  });

  // ---------- pdf layout ----------
  function targetWidth() {
    return Math.min(880, window.innerWidth - 20);
  }

  var pdfDoc = null;
  pdfjsLib.getDocument("/doc.pdf").promise.then(function (pdf) {
    pdfDoc = pdf;
    document.getElementById("loading").remove();
    pageW = targetWidth();
    var chain = Promise.resolve();
    var i;
    for (i = 1; i <= pdf.numPages; i++) (function (n) {
      chain = chain.then(function () { return pdf.getPage(n); }).then(function (p) {
        var vp = p.getViewport({ scale: 1 });
        addPage(n, p, vp.height / vp.width);
      });
    })(i);
    chain.then(connect);
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) renderPdfPage(parseInt(en.target.dataset.page, 10));
    });
  }, { rootMargin: "600px" });

  function addPage(n, pdfPage, aspect) {
    var el = document.createElement("div");
    el.className = "page";
    el.dataset.page = n;
    var pdfc = document.createElement("canvas"); pdfc.className = "pdfc";
    var inkc = document.createElement("canvas"); inkc.className = "inkc";
    var overlay = document.createElement("div"); overlay.className = "overlay";
    el.appendChild(pdfc); el.appendChild(inkc); el.appendChild(overlay);
    doc.appendChild(el);
    var pg = { el: el, pdfc: pdfc, inkc: inkc, overlay: overlay,
               aspect: aspect, rendered: false, pdfPage: pdfPage };
    pages[n] = pg;
    sizePage(n);
    observer.observe(el);
    bindPageEvents(n);
  }

  function sizePage(n) {
    var pg = pages[n];
    var w = pageW, h = Math.round(w * pg.aspect);
    var dpr = window.devicePixelRatio || 1;
    pg.el.style.width = w + "px";
    pg.el.style.height = h + "px";
    pg.inkc.width = w * dpr; pg.inkc.height = h * dpr;
    pg.inkc.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawInk(n);
  }

  function renderPdfPage(n) {
    var pg = pages[n];
    if (!pg || pg.rendered) return;
    pg.rendered = true;
    var dpr = window.devicePixelRatio || 1;
    var vp = pg.pdfPage.getViewport({ scale: (pageW * dpr) / pg.pdfPage.getViewport({ scale: 1 }).width });
    pg.pdfc.width = vp.width; pg.pdfc.height = vp.height;
    pg.pdfPage.render({ canvasContext: pg.pdfc.getContext("2d"), viewport: vp });
  }

  var resizeTimer = null;
  addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (Math.abs(targetWidth() - pageW) < 4) return;
      pageW = targetWidth();
      var n;
      for (n = 1; n < pages.length; n++) if (pages[n]) {
        pages[n].rendered = false;
        sizePage(n);
        renderPdfPage(n);
      }
      textEls.forEach(function (el) { positionTextbox(el); });
    }, 300);
  });

  // ---------- ink ----------
  function drawStroke(n, s) {
    var pg = pages[n];
    if (!pg) return;
    var ctx = pg.inkc.getContext("2d");
    var w = pageW, h = w * pg.aspect;
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(3, w * 0.006);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h);
    var i;
    for (i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function redrawInk(n) {
    var pg = pages[n];
    if (!pg) return;
    var ctx = pg.inkc.getContext("2d");
    ctx.clearRect(0, 0, pageW, pageW * pg.aspect);
    (strokesByPage[n] || []).forEach(function (s) { drawStroke(n, s); });
  }
  function redrawAll() {
    var n;
    for (n = 1; n < pages.length; n++) if (pages[n]) redrawInk(n);
  }

  // ---------- input ----------
  function norm(pg, e) {
    var r = pg.el.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  var drawing = false, drawPage = 0, buf = [];

  function bindPageEvents(n) {
    var pg = pages[n];

    pg.el.addEventListener("pointerdown", function (e) {
      if (TOOL !== "brush" || e.button !== 0) return;
      drawing = true; drawPage = n; buf = [norm(pg, e)];
      pg.el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    pg.el.addEventListener("pointermove", function (e) {
      sendCursor(n, e);
      if (!drawing || drawPage !== n) return;
      var p = norm(pg, e);
      var prev = buf[buf.length - 1];
      buf.push(p);
      drawStroke(n, { color: COLOR, points: [prev, p] });
    });
    pg.el.addEventListener("pointerup", function () {
      if (drawing && drawPage === n) flush(false);
      drawing = false;
    });

    pg.overlay.addEventListener("click", function (e) {
      if (TOOL !== "text" || e.target !== pg.overlay) return;
      var p = norm(pg, e);
      var id = Math.random().toString(36).slice(2, 10);
      var el = ensureTextbox({ id: id, color: COLOR, page: n, x: p[0], y: p[1], text: "" });
      el.focus();
      sendText(id);
    });
  }

  setInterval(function () { if (drawing) flush(true); }, 120);
  function flush(continuing) {
    if (buf.length < 2) return;
    var pts = buf;
    buf = continuing ? [pts[pts.length - 1]] : [];
    (strokesByPage[drawPage] = strokesByPage[drawPage] || [])
      .push({ color: COLOR, points: pts });
    post("/api/stroke", { session: SESSION, origin: ID, color: COLOR,
                          page: drawPage, points: pts });
  }

  var lastCursorAt = 0;
  function sendCursor(n, e) {
    var t = Date.now();
    if (t - lastCursorAt < 50) return;
    lastCursorAt = t;
    var p = norm(pages[n], e);
    post("/api/cursor", { session: SESSION, id: ID, color: COLOR,
                          page: n, x: p[0], y: p[1] });
  }

  // ---------- text boxes ----------
  var textMeta = new Map();   // id -> {page, x, y, color}
  var sendState = new Map();  // id -> {inflight, lastSent}

  function positionTextbox(el) {
    var m = textMeta.get(el.dataset.id);
    if (!m || !pages[m.page]) return;
    el.style.left = (m.x * pageW) + "px";
    el.style.top = (m.y * pageW * pages[m.page].aspect) + "px";
  }
  function autosize(el) {
    el.style.height = "auto";
    el.style.height = (el.scrollHeight + 2) + "px";
  }

  function ensureTextbox(t) {
    var el = textEls.get(t.id);
    if (!el) {
      el = document.createElement("textarea");
      el.className = "textbox";
      el.dataset.id = t.id;
      el.rows = 1;
      el.style.borderColor = t.color;
      el.spellcheck = false;
      textEls.set(t.id, el);
      el.addEventListener("input", function () { autosize(el); sendText(t.id); });
      el.addEventListener("blur", function () {
        if (!el.value.trim()) {
          post("/api/text/delete", { session: SESSION, id: t.id });
          removeTextbox(t.id);
        }
      });
      el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    }
    textMeta.set(t.id, { page: t.page, x: t.x, y: t.y, color: t.color });
    if (pages[t.page] && el.parentNode !== pages[t.page].overlay) {
      pages[t.page].overlay.appendChild(el);
    }
    if (document.activeElement !== el && el.value !== t.text) {
      el.value = t.text;
      autosize(el);
    }
    positionTextbox(el);
    return el;
  }
  function removeTextbox(id) {
    var el = textEls.get(id);
    if (el) el.remove();
    textEls.delete(id); textMeta.delete(id); sendState.delete(id);
  }

  function sendText(id) {
    var st = sendState.get(id) || { inflight: false, lastSent: null };
    sendState.set(id, st);
    var el = textEls.get(id);
    var m = textMeta.get(id);
    if (!el || !m || st.inflight || el.value === st.lastSent) return;
    st.inflight = true;
    st.lastSent = el.value;
    post("/api/text", { session: SESSION, id: id, origin: ID, color: m.color,
                        page: m.page, x: m.x, y: m.y, text: el.value })
      .catch(function () { st.lastSent = null; })
      .then(function () {
        st.inflight = false;
        if (el.value !== st.lastSent) sendText(id);
      });
  }

  // ---------- cursors ----------
  function renderCursors(list) {
    var seen = new Set();
    list.forEach(function (c) {
      if (c.id === ID || !pages[c.page]) return;
      seen.add(c.id);
      var entry = cursorEls.get(c.id);
      if (!entry) {
        var el = document.createElement("div");
        el.className = "cursor";
        var dot = document.createElement("div");
        dot.className = "dot"; dot.style.background = c.color;
        var tag = document.createElement("div");
        tag.className = "tag"; tag.style.background = c.color; tag.textContent = c.id;
        el.appendChild(dot); el.appendChild(tag);
        entry = { el: el, page: 0 };
        cursorEls.set(c.id, entry);
      }
      if (entry.page !== c.page) {
        pages[c.page].overlay.appendChild(entry.el);
        entry.page = c.page;
      }
      var pg = pages[c.page];
      entry.el.style.transform = "translate(" + (c.x * pageW) + "px," +
                                 (c.y * pageW * pg.aspect) + "px)";
    });
    cursorEls.forEach(function (entry, id) {
      if (!seen.has(id)) { entry.el.remove(); cursorEls.delete(id); }
    });
  }

  // ---------- receive ----------
  function connect() {
    var es = new EventSource("/api/events?s=" + SESSION);
    es.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.reset) {
        strokesByPage = {}; maxSeenStroke = 0; redrawAll();
      }
      if (m.strokes) m.strokes.forEach(function (s) {
        if (s.id <= maxSeenStroke) return;
        maxSeenStroke = s.id;
        if (s.origin === ID) return;   // drew it locally already
        (strokesByPage[s.page] = strokesByPage[s.page] || [])
          .push({ color: s.color, points: s.points });
        drawStroke(s.page, s);
      });
      if (m.texts) {
        var present = new Set();
        m.texts.forEach(function (t) { present.add(t.id); ensureTextbox(t); });
        textEls.forEach(function (el, id) {
          if (!present.has(id) && document.activeElement !== el) removeTextbox(id);
        });
      }
      if (m.cursors) renderCursors(m.cursors);
    };
  }
</script>
</body>
</html>`;
}
