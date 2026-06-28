/**
 * js-notes — persistent notes API backed by C3, standard Workers API.
 *
 * Setup:
 *   ribo db create notes && ribo deploy
 *   curl -X POST http://localhost:8080/<addr>/init
 *
 * Routes:
 *   POST   /init           create schema (idempotent)
 *   GET    /notes          list all notes
 *   GET    /notes/:id      get one note
 *   POST   /notes          { title, body? }
 *   PATCH  /notes/:id      { title?, body? }
 *   DELETE /notes/:id
 */

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      if (method === "GET" && parts.length === 0) return serveUI();
      await DB.exec(`CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        body       TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      if (method === "POST"   && parts[0] === "init")                    return await init(DB);
      if (method === "GET"    && parts[0] === "notes" && !parts[1])      return await list(DB);
      if (method === "GET"    && parts[0] === "notes" &&  parts[1])      return await get(DB, id(parts[1]));
      if (method === "POST"   && parts[0] === "notes")                   return await create(DB, await json(request));
      if (method === "PATCH"  && parts[0] === "notes" &&  parts[1])      return await update(DB, id(parts[1]), await json(request));
      if (method === "DELETE" && parts[0] === "notes" &&  parts[1])      return await remove(DB, id(parts[1]));

      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

function serveUI() {
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notes</title>
<style>
  *{box-sizing:border-box}
  body{font-family:monospace;background:#0d0d0d;color:#ccc;margin:0;padding:2rem;min-height:100vh}
  h1{font-size:1.1rem;font-weight:500;color:#eee;margin:0 0 1.5rem}
  .form{display:flex;flex-direction:column;gap:.5rem;margin-bottom:2rem;max-width:520px}
  input,textarea{background:#1a1a1a;border:1px solid #333;color:#eee;padding:.5rem .75rem;border-radius:4px;font-family:inherit;font-size:.85rem}
  input::placeholder,textarea::placeholder{color:#555}
  textarea{resize:vertical;min-height:80px}
  button{background:#0066ff;color:#fff;border:none;padding:.5rem 1rem;border-radius:4px;font-family:inherit;font-size:.85rem;cursor:pointer;align-self:flex-start}
  button:hover{background:#0052cc}
  #msg{font-size:.8rem;margin-bottom:1rem;min-height:1.2em}
  .ok{color:#33ff77}.err{color:#ff4444}
  .notes{display:flex;flex-direction:column;gap:.75rem}
  .note-card{border:1px solid #222;border-radius:6px;padding:.85rem 1rem}
  .note-head{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem}
  .note-title{color:#eee;font-size:.88rem;font-weight:500}
  .note-date{color:#444;font-size:.7rem;flex-shrink:0}
  .note-body{color:#888;font-size:.8rem;margin-top:.4rem;white-space:pre-wrap;word-break:break-word}
  .del{color:#333;cursor:pointer;padding:0 .25rem;font-size:.8rem}
  .del:hover{color:#ff4444}
  .empty{color:#444;font-size:.8rem;padding:.5rem 0}
</style></head><body>
<h1>notes</h1>
<div class="form">
  <input id="title" type="text" placeholder="Title" autocomplete="off">
  <textarea id="body" placeholder="Body (optional)"></textarea>
  <button onclick="addNote()">Add note</button>
</div>
<div id="msg"></div>
<div class="notes" id="notes"><div class="empty">loading…</div></div>
<script>
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function loadNotes() {
  const r = await fetch('/notes');
  const {notes=[]} = await r.json();
  const el = document.getElementById('notes');
  if (!notes.length) { el.innerHTML='<div class="empty">no notes yet</div>'; return; }
  el.innerHTML = notes.map(n=>\`<div class="note-card">
    <div class="note-head">
      <span class="note-title">\${esc(n.title)}</span>
      <span style="display:flex;gap:.5rem;align-items:baseline">
        <span class="note-date">\${esc(n.updated_at)}</span>
        <span class="del" onclick="delNote(\${n.id})">✕</span>
      </span>
    </div>
    \${n.body ? '<div class="note-body">'+esc(n.body)+'</div>' : ''}
  </div>\`).join('');
}
async function addNote() {
  const title = document.getElementById('title').value.trim();
  const body = document.getElementById('body').value.trim();
  const m = document.getElementById('msg');
  if (!title) { m.innerHTML='<span class="err">title is required</span>'; return; }
  const r = await fetch('/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,body})});
  const d = await r.json();
  if (!r.ok) { m.innerHTML='<span class="err">'+esc(d.error||'error')+'</span>'; return; }
  m.innerHTML='<span class="ok">added</span>';
  document.getElementById('title').value='';
  document.getElementById('body').value='';
  loadNotes();
}
async function delNote(id) {
  await fetch('/notes/'+id,{method:'DELETE'});
  loadNotes();
}
loadNotes();
</script></body></html>`, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}

async function init(DB) {
  await DB.exec(`CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  return ok({ ok: true, message: "notes table ready" });
}

async function list(DB) {
  const { results } = await DB.prepare(
    "SELECT id, title, body, created_at, updated_at FROM notes ORDER BY updated_at DESC"
  ).all();
  return ok({ notes: results, count: results.length });
}

async function get(DB, noteId) {
  const row = await DB.prepare("SELECT * FROM notes WHERE id = ?").bind(noteId).first();
  if (!row) return err(404, `Note ${noteId} not found`);
  return ok({ note: row });
}

async function create(DB, body) {
  const { title, body: text = "" } = body;
  if (!title) throw typed(400, "title is required");
  await DB.prepare("INSERT INTO notes (title, body) VALUES (?, ?)").bind(title, text).run();
  const row = await DB.prepare("SELECT * FROM notes ORDER BY id DESC LIMIT 1").first();
  return ok({ note: row }, 201);
}

async function update(DB, noteId, body) {
  const { title, body: text } = body;
  if (!title && text === undefined) throw typed(400, "provide at least title or body");
  const sets = [], params = [];
  if (title !== undefined) { sets.push("title = ?");               params.push(title); }
  if (text  !== undefined) { sets.push("body = ?");                params.push(text); }
  sets.push("updated_at = datetime('now')");
  params.push(noteId);
  const meta = await DB.prepare(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
  if (!meta?.meta?.rows_affected) return err(404, `Note ${noteId} not found`);
  const row = await DB.prepare("SELECT * FROM notes WHERE id = ?").bind(noteId).first();
  return ok({ note: row });
}

async function remove(DB, noteId) {
  const meta = await DB.prepare("DELETE FROM notes WHERE id = ?").bind(noteId).run();
  if (!meta?.meta?.rows_affected) return err(404, `Note ${noteId} not found`);
  return ok({ deleted: noteId });
}

function id(s) {
  const n = parseInt(s, 10);
  if (isNaN(n)) throw typed(400, `invalid id: ${s}`);
  return n;
}

async function json(req) {
  const text = await req.text();
  if (!text) throw typed(400, "request body required");
  try { return JSON.parse(text); } catch { throw typed(400, "invalid JSON body"); }
}

function typed(code, message) {
  const e = new Error(message);
  e.status = code;
  return e;
}

function ok(data, status = 200) {
  return Response.json(data, { status });
}

function err(status, message) {
  return Response.json({ error: message }, { status });
}
