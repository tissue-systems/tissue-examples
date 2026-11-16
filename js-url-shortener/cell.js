/**
 * js-url-shortener — URL shortener with C3 persistence, standard Request/Response API.
 *
 * Setup:
 *   ribo db create urls
 *   ribo vault set url-shortener ADMIN_TOKEN
 *   ribo deploy
 *
 * Routes (only the redirect is public; the rest need `Authorization: Bearer <ADMIN_TOKEN>`):
 *   POST   /init       create schema
 *   POST   /shorten    { url, code? } → { code, short_url, url }
 *   GET    /:code      → 301 redirect, increments click count
 *   GET    /links      list all links with click counts
 *   DELETE /:code      delete a link
 */

const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
// A code is a URL path segment and lands in the admin page, so it is kept to
// characters that need no escaping anywhere.
const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_URL = 2048;
// A vault value that was never set arrives as this placeholder.
const VAULT_UNSET = "***REMOVED***";

async function authorized(request, env) {
  const secret = env.ADMIN_TOKEN;
  if (typeof secret !== "string" || secret === "" || secret === VAULT_UNSET) {
    throw typed(503, "admin routes are off until ADMIN_TOKEN is set: ribo vault set url-shortener ADMIN_TOKEN");
  }
  const h = request.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, secret].map((v) => crypto.subtle.digest("SHA-256", enc.encode(v))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  if (!given || diff !== 0) throw typed(401, "unauthorized");
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      if (method === "GET"  && parts.length === 0)       return serveUI();
      // Auto-create table so cell works immediately after deploy
      await DB.exec(`CREATE TABLE IF NOT EXISTS links (
        code       TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        clicks     INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      if (method === "GET"  && parts.length === 1 && parts[0] !== "links") return await redirect(DB, parts[0]);

      await authorized(request, env);
      if (method === "POST" && parts[0] === "init")     return await init(DB);
      if (method === "POST" && parts[0] === "shorten")  return await shorten(DB, await json(request), url);
      if (method === "GET"  && parts[0] === "links")    return await list(DB);
      if (method === "DELETE" && parts.length === 1)    return await remove(DB, parts[0]);

      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function init(DB) {
  await DB.exec(`CREATE TABLE IF NOT EXISTS links (
    code       TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    clicks     INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  return ok({ ok: true, message: "links table ready" });
}

async function shorten(DB, body, reqUrl) {
  const { url: target, code: reqCode } = body;
  if (typeof target !== "string" || !target) throw typed(400, "url is required");
  if (target.length > MAX_URL) throw typed(400, `url must be at most ${MAX_URL} characters`);
  let parsed;
  try { parsed = new URL(target); } catch { throw typed(400, "url must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw typed(400, "url must use http or https");
  const code = reqCode ?? randomCode(8);
  if (typeof code !== "string" || !CODE_RE.test(code)) throw typed(400, "code must be 1-32 letters, digits, - or _");
  const existing = await DB.prepare("SELECT code FROM links WHERE code = ?").bind(code).first();
  if (existing) throw typed(409, `code "${code}" already in use`);
  await DB.prepare("INSERT INTO links (code, url) VALUES (?, ?)").bind(code, target).run();
  const short_url = `${reqUrl.protocol}//${reqUrl.host}/${code}`;
  return ok({ code, short_url, url: target }, 201);
}

async function redirect(DB, code) {
  if (!CODE_RE.test(code)) return err(404, "not found");
  const row = await DB.prepare("SELECT url FROM links WHERE code = ?").bind(code).first();
  if (!row) return err(404, `Code "${code}" not found`);
  // Rows written before the scheme check existed are not followed blindly.
  let dest;
  try { dest = new URL(row.url); } catch { return err(404, "not found"); }
  if (!["http:", "https:"].includes(dest.protocol)) return err(404, "not found");
  await DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE code = ?").bind(code).run();
  return new Response(null, { status: 301, headers: { location: row.url } });
}

async function list(DB) {
  const { results } = await DB.prepare(
    "SELECT code, url, clicks, created_at FROM links ORDER BY created_at DESC"
  ).all();
  return ok({ links: results, count: results.length });
}

async function remove(DB, code) {
  if (!CODE_RE.test(code)) return err(404, "not found");
  const meta = await DB.prepare("DELETE FROM links WHERE code = ?").bind(code).run();
  if (!meta?.meta?.rows_affected) return err(404, `Code "${code}" not found`);
  return ok({ deleted: code });
}

function serveUI() {
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>URL Shortener</title>
<style>
  *{box-sizing:border-box}
  body{font-family:monospace;background:#0d0d0d;color:#ccc;margin:0;padding:2rem;min-height:100vh}
  h1{font-size:1.1rem;font-weight:500;color:#eee;margin:0 0 1.5rem}
  .form{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:2rem}
  input{background:#1a1a1a;border:1px solid #333;color:#eee;padding:.5rem .75rem;border-radius:4px;font-family:inherit;font-size:.85rem;flex:1;min-width:0}
  input::placeholder{color:#555}
  button{background:#0066ff;color:#fff;border:none;padding:.5rem 1rem;border-radius:4px;font-family:inherit;font-size:.85rem;cursor:pointer;white-space:nowrap}
  button:hover{background:#0052cc}
  #msg{font-size:.8rem;margin-bottom:1rem;min-height:1.2em}
  .ok{color:#33ff77}.err{color:#ff4444}
  table{width:100%;border-collapse:collapse;font-size:.82rem}
  th{text-align:left;color:#666;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;padding:.4rem .5rem;border-bottom:1px solid #222}
  td{padding:.5rem;border-bottom:1px solid #1a1a1a;vertical-align:middle}
  a{color:#0066ff;text-decoration:none}a:hover{text-decoration:underline}
  .code{color:#33ff77;font-weight:500}
  .clicks{color:#888;text-align:right}
  .del{color:#555;cursor:pointer;padding:0 .25rem}
  .del:hover{color:#ff4444}
  .empty{color:#444;font-size:.8rem;padding:1rem .5rem}
</style></head><body>
<h1>url-shortener</h1>
<div class="form">
  <input id="token" type="password" placeholder="admin token" autocomplete="current-password">
</div>
<div class="form">
  <input id="url" type="url" placeholder="https://example.com" required>
  <input id="code" type="text" placeholder="custom code (optional)" maxlength="32">
  <button onclick="shorten()">Shorten</button>
</div>
<div id="msg"></div>
<table id="tbl">
  <thead><tr><th>code</th><th>destination</th><th>clicks</th><th></th></tr></thead>
  <tbody id="tbody"><tr><td class="empty" colspan="4">loading…</td></tr></tbody>
</table>
<script>
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function auth(){return {authorization:'Bearer '+document.getElementById('token').value};}
document.getElementById('token').addEventListener('change', loadLinks);
async function shorten() {
  const url = document.getElementById('url').value.trim();
  const code = document.getElementById('code').value.trim() || undefined;
  if (!url) return;
  const m = document.getElementById('msg');
  try {
    const r = await fetch('/shorten', {method:'POST',headers:{'content-type':'application/json',...auth()},body:JSON.stringify({url,code})});
    const d = await r.json();
    if (!r.ok) { m.innerHTML='<span class="err">'+esc(d.error||'error')+'</span>'; return; }
    m.innerHTML='<span class="ok">↗ <a href="/'+esc(d.code)+'" target="_blank" rel="noopener noreferrer">'+esc(location.origin)+'/'+esc(d.code)+'</a></span>';
    document.getElementById('url').value='';
    document.getElementById('code').value='';
    loadLinks();
  } catch(e) { document.getElementById('msg').textContent=e.message; }
}
async function del(code) {
  await fetch('/'+encodeURIComponent(code),{method:'DELETE',headers:auth()});
  loadLinks();
}
async function loadLinks() {
  try {
    const r = await fetch('/links',{headers:auth()});
    if (!r.ok) { document.getElementById('tbody').innerHTML='<tr><td class="empty" colspan="4">enter the admin token to see links</td></tr>'; return; }
    const {links=[]} = await r.json();
    const tb = document.getElementById('tbody');
    if (!links.length) { tb.innerHTML='<tr><td class="empty" colspan="4">no links yet</td></tr>'; return; }
    tb.innerHTML = links.map(l=>\`<tr>
      <td><a class="code" href="/\${esc(l.code)}" target="_blank" rel="noopener noreferrer">\${esc(l.code)}</a></td>
      <td><a href="\${esc(l.url)}" target="_blank" rel="noopener noreferrer">\${esc(l.url.length>60?l.url.slice(0,60)+'…':l.url)}</a></td>
      <td class="clicks">\${Number(l.clicks)}</td>
      <td><span class="del" data-code="\${esc(l.code)}">✕</span></td>
    </tr>\`).join('');
  } catch(e) {}
}
document.getElementById('tbody').addEventListener('click', (e) => {
  const code = e.target.closest('.del')?.dataset.code;
  if (code) del(code);
});
loadLinks();
</script></body></html>`, {headers:{'content-type':'text/html;charset=utf-8'}});
}

function randomCode(len) {
  // 252 is the largest multiple of 36 below 256; rejecting bytes above it keeps
  // every character equally likely.
  const out = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 252 && out.length < len) out.push(ALPHA[b % 36]);
    }
  }
  return out.join("");
}

async function json(req) {
  const text = await req.text();
  if (!text) throw typed(400, "request body required");
  try { return JSON.parse(text); } catch { throw typed(400, "invalid JSON body"); }
}

export const __test = { CODE_RE, randomCode };

function typed(code, message) { const e = new Error(message); e.status = code; return e; }
function ok(data, status = 200) { return Response.json(data, { status }); }
function err(status, message) { return Response.json({ error: message }, { status }); }
