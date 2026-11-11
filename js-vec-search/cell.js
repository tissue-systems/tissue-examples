/**
 * js-vec-search: semantic search over documents with c3's built-in vector
 * columns and distance functions (F32_BLOB, vector32, vector_distance_cos).
 * They're part of libSQL, the SQLite fork c3 runs on, so there's no
 * extension to load.
 *
 * Embeddings come from OpenAI's embeddings API, called with the Cell
 * owner's own key from a vault binding.
 *
 * Setup:
 *   ribo db create vec-search
 *   ribo vault set vec-search OPENAI_API_KEY
 *   ribo deploy
 *
 * Routes:
 *   POST /documents        { title, body }: embed and store a document
 *   GET  /documents        list all documents (without embeddings)
 *   GET  /search?q=...     embed the query, rank stored docs by cosine distance
 *
 * Docs: https://tissue.systems/docs/c3/vector-search/
 */

const EMBEDDINGS_API = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const DDL = [
  // F32_BLOB(n) holds n float32 values; n has to match the embedding model.
  `CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    embedding  F32_BLOB(${EMBEDDING_DIMENSIONS}),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      for (const sql of DDL) await DB.exec(sql);

      if (method === "GET"  && parts.length === 0)        return serveUI();
      if (method === "POST" && parts[0] === "documents")  return await createDocument(DB, env, await json(request));
      if (method === "GET"  && parts[0] === "documents")  return await listDocuments(DB);
      if (method === "GET"  && parts[0] === "search")     return await search(DB, env, url.searchParams.get("q"));

      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function createDocument(DB, env, body) {
  const title = (body.title ?? "").trim();
  const text  = (body.body ?? "").trim();
  if (!title || !text) throw typed(400, "title and body are required");

  const [embedding] = await embed(apiKey(env), [`${title}\n\n${text}`]);

  // vector32() reads a JSON array as text. Bound parameters travel as JSON,
  // so the plain number[] from the API arrives in exactly that form.
  const { results } = await DB.prepare(`
    INSERT INTO documents (title, body, embedding)
    VALUES (?, ?, vector32(?))
    RETURNING id, title, body, created_at
  `).bind(title, text, embedding).all();

  return Response.json(results[0], { status: 201 });
}

async function listDocuments(DB) {
  // The embedding column is left out: selected raw, it comes back as an
  // array of byte values. vector_extract(embedding) returns it as text.
  const { results } = await DB.prepare(
    "SELECT id, title, body, created_at FROM documents ORDER BY id DESC"
  ).all();
  return Response.json(results);
}

async function search(DB, env, q) {
  if (!q || !q.trim()) throw typed(400, "?q= is required");

  const [queryEmbedding] = await embed(apiKey(env), [q]);

  // An exact scan: every row's distance to the query, computed inside the
  // database. Tens of thousands of rows take tens of milliseconds. The docs
  // cover the approximate index (libsql_vector_idx + vector_top_k) for
  // larger tables. A NULL embedding fails the whole query, hence the WHERE.
  const { results } = await DB.prepare(`
    SELECT
      id, title, body,
      vector_distance_cos(embedding, vector32(?)) AS distance
    FROM documents
    WHERE embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT 10
  `).bind(queryEmbedding).all();

  return Response.json({ query: q, results });
}

function apiKey(env) {
  if (!env.OPENAI_API_KEY) {
    throw typed(503, "OPENAI_API_KEY is not set. Run: ribo vault set vec-search OPENAI_API_KEY, then ribo deploy");
  }
  return env.OPENAI_API_KEY;
}

// Calls OpenAI's embeddings endpoint. Returns an array of float arrays,
// one per input string, in the same order.
async function embed(apiKey, inputs) {
  const res = await fetch(EMBEDDINGS_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw typed(res.status === 401 ? 401 : 502, `embeddings API error: ${res.status} ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

function serveUI() {
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vector Search</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#f7f7f8;color:#1a1a1a;margin:0;padding:2rem 1rem}
  .card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);max-width:640px;margin:0 auto;padding:1.5rem}
  h1{font-size:1.3rem;margin:0 0 1rem}
  .row{display:flex;gap:.5rem;margin-bottom:.6rem}
  input{flex:1;padding:.55rem .75rem;border:1px solid #ddd;border-radius:6px;font-size:.95rem;font-family:inherit}
  button{padding:.55rem 1.1rem;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.9rem}
  .result{padding:.7rem 0;border-bottom:1px solid #eee}
  .result h3{font-size:.95rem;margin:0 0 .25rem;display:flex;justify-content:space-between;gap:.5rem}
  .result .dist{font-family:ui-monospace,monospace;font-size:.75rem;color:#999;font-weight:400}
  .result p{font-size:.85rem;color:#555;margin:0}
  .muted{color:#999;font-size:.8rem}
</style>
</head><body>
  <div class="card">
    <h1>Semantic search <span class="muted">(c3 vectors)</span></h1>
    <div class="row">
      <input id="q" placeholder="Describe what you're looking for…" autocomplete="off">
      <button onclick="doSearch()">Search</button>
    </div>
    <div id="results"></div>
    <p class="muted">Unlike keyword search, queries match by <em>meaning</em>: "how do I host my app" can match a document titled "deploying with ribo" even with no shared words. POST documents via <code>/documents</code> first.</p>
  </div>
<script>
async function doSearch() {
  const q = document.getElementById('q').value.trim();
  const out = document.getElementById('results');
  if (!q) { out.innerHTML = ''; return; }
  out.innerHTML = '<p class="muted">Searching…</p>';
  const res = await fetch('/search?q=' + encodeURIComponent(q));
  const { results } = await res.json();
  out.innerHTML = results.length
    ? results.map(r => \`<div class="result"><h3>\${esc(r.title)}<span class="dist">distance \${r.distance.toFixed(4)}</span></h3><p>\${esc(r.body.slice(0, 160))}\${r.body.length > 160 ? '…' : ''}</p></div>\`).join('')
    : '<p class="muted">No documents yet. POST some to /documents.</p>';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function json(request) {
  try { return await request.json(); }
  catch { throw typed(400, "expected JSON body"); }
}
function typed(status, message) { const e = new Error(message); e.status = status; return e; }
function err(status, message) { return Response.json({ error: message }, { status }); }
