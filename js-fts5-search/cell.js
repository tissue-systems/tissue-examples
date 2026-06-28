/**
 * js-fts5-search — keyword full-text search over notes using SQLite FTS5.
 *
 * FTS5 ships in every standard SQLite build, including libSQL — c3 needs
 * no changes for this. The notes table and its FTS5 index are kept in sync
 * with triggers, which is the standard SQLite pattern (the "external content"
 * table approach).
 *
 * Setup:
 *   ribo db create fts5-search && ribo deploy
 *
 * Routes:
 *   POST   /notes          { title, body } — create a note
 *   GET    /notes          — list all notes, newest first
 *   DELETE /notes/:id      — delete a note
 *   GET    /search?q=...   — keyword search with ranked results + highlighted snippets
 */

// Each statement is executed separately — DB.exec() only runs one statement
// per call (libSQL conn.query behaviour).
const DDL = [
  `CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // _meta tracks one-time setup steps so they don't re-run on every request.
  `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`,
  // "External content" FTS5: indexes notes without duplicating storage.
  // content='notes' + content_rowid='id' tells FTS5 to fetch row data from
  // the notes table by rowid when snippet() needs the original text.
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, body, content='notes', content_rowid='id'
  )`,
  // Sync triggers: keep the FTS index in step with writes to notes.
  `CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END`,
];

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      for (const sql of DDL) await DB.exec(sql);
      // One-time FTS backfill: external content tables' count(*) reflects the
      // content table, not the index — can't use it to detect an empty index.
      // Instead use a _meta flag so this runs exactly once per database.
      const { results: [flag] } = await DB.prepare(
        "SELECT value FROM _meta WHERE key = 'fts_initialized'"
      ).all();
      if (!flag) {
        await DB.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
        await DB.exec("INSERT OR REPLACE INTO _meta VALUES('fts_initialized', '1')");
      }

      if (method === "GET"    && parts.length === 0)              return serveUI();
      if (method === "POST"   && parts[0] === "notes")            return await create(DB, await json(request));
      if (method === "GET"    && parts[0] === "notes")            return await list(DB);
      if (method === "DELETE" && parts[0] === "notes" && parts[1])return await remove(DB, id(parts[1]));
      if (method === "GET"    && parts[0] === "search")           return await search(DB, url.searchParams.get("q"));

      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function create(DB, body) {
  const title = (body.title ?? "").trim();
  const text  = (body.body ?? "").trim();
  if (!title) throw typed(400, "title is required");

  const { results } = await DB.prepare(
    "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body, created_at"
  ).bind(title, text).all();
  return Response.json(results[0], { status: 201 });
}

async function list(DB) {
  const { results } = await DB.prepare(
    "SELECT id, title, body, created_at FROM notes ORDER BY id DESC"
  ).all();
  return Response.json(results);
}

async function remove(DB, noteId) {
  await DB.prepare("DELETE FROM notes WHERE id = ?").bind(noteId).run();
  return new Response(null, { status: 204 });
}

async function search(DB, q) {
  if (!q || !q.trim()) throw typed(400, "?q= is required");

  // FTS5 MATCH ranks by bm25() by default when ordering by `rank`.
  // snippet(table, column, before, after, ellipsis, max_tokens) pulls a
  // highlighted excerpt around the match — column index is 0-based (title=0, body=1).
  const { results } = await DB.prepare(`
    SELECT
      notes.id,
      notes.title,
      snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS excerpt,
      bm25(notes_fts) AS score
    FROM notes_fts
    JOIN notes ON notes.id = notes_fts.rowid
    WHERE notes_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `).bind(toFtsQuery(q)).all();

  return Response.json({ query: q, results });
}

// FTS5's MATCH syntax treats bare words as AND-ed terms and supports prefix
// matching with `*`. Quote each term so punctuation in user input doesn't
// break the query syntax, and add a trailing `*` for prefix search.
function toFtsQuery(q) {
  return q
    .trim()
    .split(/\s+/)
    .map(term => `"${term.replace(/"/g, '""')}"*`)
    .join(" ");
}

function serveUI() {
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FTS5 Search</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f7f7f8;color:#1a1a1a;margin:0;padding:2rem 1rem}
  .card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);max-width:640px;margin:0 auto;padding:1.5rem}
  h1{font-size:1.3rem;margin:0 0 1rem}
  .row{display:flex;gap:.5rem;margin-bottom:.6rem}
  input,textarea{flex:1;padding:.55rem .75rem;border:1px solid #ddd;border-radius:6px;font-size:.95rem;font-family:inherit}
  textarea{resize:vertical;min-height:70px}
  button{padding:.55rem 1.1rem;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.9rem}
  mark{background:#fff1a8;border-radius:2px;padding:0 .15em}
  .result{padding:.7rem 0;border-bottom:1px solid #eee}
  .result h3{font-size:.95rem;margin:0 0 .25rem}
  .result p{font-size:.85rem;color:#555;margin:0}
  .muted{color:#999;font-size:.8rem}
</style>
</head><body>
  <div class="card">
    <h1>FTS5 keyword search <span class="muted">(SQLite full-text search)</span></h1>
    <div class="row">
      <input id="q" placeholder="Search notes…" autocomplete="off">
      <button onclick="doSearch()">Search</button>
    </div>
    <div id="results"></div>
    <p class="muted">POST a note via <code>/notes</code> to add content, then search above. Matches are ranked by BM25 with highlighted excerpts.</p>
  </div>
<script>
async function doSearch() {
  const q = document.getElementById('q').value.trim();
  const out = document.getElementById('results');
  if (!q) { out.innerHTML = ''; return; }
  const res = await fetch('/search?q=' + encodeURIComponent(q));
  const { results } = await res.json();
  out.innerHTML = results.length
    ? results.map(r => \`<div class="result"><h3>\${escapeAttr(r.title)}</h3><p>\${r.excerpt}</p></div>\`).join('')
    : '<p class="muted">No matches.</p>';
}
function escapeAttr(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function id(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n)) throw typed(400, "invalid id");
  return n;
}
async function json(request) {
  try { return await request.json(); }
  catch { throw typed(400, "expected JSON body"); }
}
function typed(status, message) { const e = new Error(message); e.status = status; return e; }
function err(status, message) { return Response.json({ error: message }, { status }); }
