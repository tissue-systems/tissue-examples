/**
 * js-live-canvas — two browser windows, one canvas.
 *
 * Open the page in two windows side by side: each window gets a colored
 * cursor the other can see moving live, and anything you draw appears in the
 * other window as you draw it.
 *
 * It demonstrates the two kinds of shared state a Cell has:
 *
 *   - Durable: strokes go to c3 (`strokes` table), so the drawing survives
 *     refreshes and new windows replay the full history on connect.
 *   - Ephemeral: cursor positions live in a module-global Map. Isolate
 *     globals persist across requests on an edge, so 25 cursor updates/sec
 *     cost zero database writes and are pushed to viewers within ~25ms.
 *
 * Delivery is SSE (`/api/events`): every write bumps an in-memory counter,
 * open streams check it every 25ms and push only what changed. A 250ms c3
 * re-check picks up strokes written on the other edge (in-memory state never
 * crosses edges — cursors are same-edge only, which is fine for two windows
 * on one desk). Streams close after ~25s; EventSource auto-reconnects.
 *
 * Routes:
 *   GET  /            — the canvas page
 *   GET  /api/events  — SSE: { strokes?, cursors?, reset? }
 *   POST /api/stroke  — { origin, color, points: [[x,y],…] }
 *   POST /api/cursor  — { id, color, x, y }   (in-memory only, no DB)
 *   POST /api/clear   — wipe the canvas for everyone
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS strokes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    origin     TEXT NOT NULL,
    color      TEXT NOT NULL,
    points     TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// Module-global (per-isolate, persists across requests on an edge).
const cursors = new Map(); // id -> { id, color, x, y, t }
let cursorSeq = 0;         // bumped on every cursor update
let strokeSeq = 0;         // bumped on every stroke insert / clear

const WAKE_MS = 25;        // in-memory signal check interval
const TICK_MS = 250;       // full c3 re-check (catches the other edge)
const STREAM_MS = 25_000;  // stream lifetime; EventSource reconnects
const CURSOR_TTL = 4_000;  // drop cursors not updated for this long

export default {
  async fetch(request, env) {
    await env.DB.exec(SCHEMA);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/events" && request.method === "GET") {
      return eventStream(env);
    }

    if (path === "/api/cursor" && request.method === "POST") {
      const { id, color, x, y } = await request.json();
      if (!okId(id) || !okColor(color)) return bad("invalid cursor");
      cursors.set(id, { id, color, x: num(x), y: num(y), t: Date.now() });
      cursorSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/stroke" && request.method === "POST") {
      const { origin, color, points } = await request.json();
      if (!okId(origin) || !okColor(color)) return bad("invalid stroke");
      if (!Array.isArray(points) || points.length < 2 || points.length > 500) {
        return bad("invalid points");
      }
      const pts = points.map(p => [num(p[0]), num(p[1])]);
      await env.DB.prepare(
        "INSERT INTO strokes (origin, color, points, created_at) VALUES (?, ?, ?, ?)"
      ).bind(origin, color, JSON.stringify(pts), new Date().toISOString()).run();
      strokeSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/api/clear" && request.method === "POST") {
      await env.DB.prepare("DELETE FROM strokes").run();
      strokeSeq++;
      return Response.json({ ok: true });
    }

    if (path === "/" && request.method === "GET") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },
};

function bad(msg) { return Response.json({ error: msg }, { status: 400 }); }
function num(v) { return Math.round(Number(v) || 0); }
function okId(s) { return typeof s === "string" && /^[a-z0-9]{1,12}$/.test(s); }
function okColor(s) { return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s); }

function liveCursors() {
  const cutoff = Date.now() - CURSOR_TTL;
  const out = [];
  for (const [id, c] of cursors) {
    if (c.t < cutoff) cursors.delete(id);
    else out.push({ id: c.id, color: c.color, x: c.x, y: c.y });
  }
  return out;
}

function eventStream(env) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("retry: 500\n\n"));
        let lastStrokeId = 0;
        let seenCursor = -1, seenStroke = -1;
        let lastCursorPayload = null, lastTick = 0;
        const deadline = Date.now() + STREAM_MS;
        while (!cancelled && Date.now() < deadline) {
          const t = Date.now();
          const out = {};

          if (cursorSeq !== seenCursor || t - lastTick >= TICK_MS) {
            seenCursor = cursorSeq;
            const payload = JSON.stringify(liveCursors());
            if (payload !== lastCursorPayload) {
              lastCursorPayload = payload;
              out.cursors = JSON.parse(payload);
            }
          }

          if (strokeSeq !== seenStroke || t - lastTick >= TICK_MS) {
            seenStroke = strokeSeq;
            lastTick = t;
            const { results: [{ m }] } = await env.DB.prepare(
              "SELECT IFNULL(MAX(id), 0) AS m FROM strokes"
            ).all();
            if (m < lastStrokeId) {           // canvas was cleared
              out.reset = true;
              lastStrokeId = 0;
            }
            if (m > lastStrokeId) {
              const { results } = await env.DB.prepare(
                "SELECT id, origin, color, points FROM strokes WHERE id > ? ORDER BY id"
              ).bind(lastStrokeId).all();
              out.strokes = results.map(r => ({
                origin: r.origin, color: r.color, points: JSON.parse(r.points),
              }));
              lastStrokeId = m;
            }
          }

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

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>live canvas</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { height: 100%; overflow: hidden }
  body { font-family: system-ui, sans-serif; background: #fbfaf7 }
  canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair }
  .cursor { position: absolute; left: 0; top: 0; pointer-events: none;
    transition: transform 60ms linear; z-index: 2 }
  .cursor .dot { width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25) }
  .cursor .tag { margin-top: 3px; font-size: .68rem; color: #fff;
    padding: .1rem .35rem; border-radius: 4px; white-space: nowrap }
  .bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: #fff; border: 1px solid #e4e0d6; border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,.06); padding: .5rem .8rem;
    display: flex; align-items: center; gap: .7rem; z-index: 3; font-size: .82rem }
  .bar .swatch { width: 14px; height: 14px; border-radius: 50% }
  .bar .hint { color: #8a857a }
  .bar button { background: none; border: 1px solid #e4e0d6; border-radius: 7px;
    padding: .25rem .6rem; font-size: .78rem; cursor: pointer; color: #6b675e }
  .bar button:hover { border-color: #c8c2b2 }
</style>
</head>
<body>
<canvas id="cv"></canvas>
<div id="cursors"></div>
<div class="bar">
  <span class="swatch" id="swatch"></span>
  <strong>live canvas</strong>
  <span class="hint">open this URL in a second window and draw</span>
  <button id="clear">Clear</button>
</div>
<script>
  var COLORS = ["#e5484d","#f76b15","#d6a514","#30a46c","#00b57e","#3e63dd","#8e4ec6","#e93d82"];
  var ID = Math.random().toString(36).slice(2, 8);
  var COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];
  document.getElementById("swatch").style.background = COLOR;

  var cv = document.getElementById("cv");
  var ctx = cv.getContext("2d");
  var strokes = [];   // everything drawn, mine + theirs, for redraw on resize

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px";
    cv.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function drawStroke(s) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (var i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
    ctx.stroke();
  }
  function redraw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    strokes.forEach(drawStroke);
  }
  addEventListener("resize", resize);
  resize();

  // --- drawing: draw locally at once, ship chunks every 120ms ---
  var drawing = false, buf = [];
  cv.addEventListener("pointerdown", function (e) {
    drawing = true;
    buf = [[e.clientX, e.clientY]];
  });
  addEventListener("pointermove", function (e) {
    sendCursor(e);
    if (!drawing) return;
    var prev = buf[buf.length - 1];
    buf.push([e.clientX, e.clientY]);
    drawStroke({ color: COLOR, points: [prev, [e.clientX, e.clientY]] });
  });
  addEventListener("pointerup", function () {
    if (drawing) flush(false);
    drawing = false;
  });
  setInterval(function () { if (drawing) flush(true); }, 120);

  function flush(continuing) {
    if (buf.length < 2) return;
    var pts = buf;
    buf = continuing ? [pts[pts.length - 1]] : [];
    strokes.push({ color: COLOR, points: pts });
    fetch("/api/stroke", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: ID, color: COLOR, points: pts }) });
  }

  document.getElementById("clear").addEventListener("click", function () {
    fetch("/api/clear", { method: "POST" });
  });

  // --- cursor presence: throttled, in-memory on the server ---
  var lastCursorAt = 0;
  function sendCursor(e) {
    var t = Date.now();
    if (t - lastCursorAt < 40) return;
    lastCursorAt = t;
    fetch("/api/cursor", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ID, color: COLOR, x: e.clientX, y: e.clientY }) });
  }

  // --- receive ---
  var holder = document.getElementById("cursors");
  var cursorEls = new Map();
  function renderCursors(list) {
    var seen = new Set();
    list.forEach(function (c) {
      if (c.id === ID) return;
      seen.add(c.id);
      var el = cursorEls.get(c.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "cursor";
        var dot = document.createElement("div");
        dot.className = "dot";
        dot.style.background = c.color;
        var tag = document.createElement("div");
        tag.className = "tag";
        tag.style.background = c.color;
        tag.textContent = c.id;
        el.appendChild(dot); el.appendChild(tag);
        holder.appendChild(el);
        cursorEls.set(c.id, el);
      }
      el.style.transform = "translate(" + c.x + "px," + c.y + "px)";
    });
    cursorEls.forEach(function (el, id) {
      if (!seen.has(id)) { el.remove(); cursorEls.delete(id); }
    });
  }

  var es = new EventSource("/api/events");
  es.onmessage = function (e) {
    var m = JSON.parse(e.data);
    if (m.reset) { strokes = []; redraw(); }
    if (m.strokes) m.strokes.forEach(function (s) {
      if (s.origin === ID) return;   // already drew our own locally
      strokes.push(s);
      drawStroke(s);
    });
    if (m.cursors) renderCursors(m.cursors);
  };
</script>
</body>
</html>`;
