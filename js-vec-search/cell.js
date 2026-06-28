/**
 * js-vec-search — semantic ("meaning-based") search over documents using
 * libSQL's NATIVE vector type and distance functions.
 *
 * IMPORTANT: this is NOT the sqlite-vec extension (vec0 virtual tables /
 * HNSW). It's libSQL's own built-in vector support — F32_BLOB columns plus
 * vector32() / vector_distance_cos() — which ships compiled into c3's
 * libsql dependency today, with no extension loading required.
 * See plans/plan-sqlite-vec.md for the full reasoning.
 *
 * Embeddings come from OpenAI's embeddings API. The key is supplied by the
 * Cell owner and stored in c3 — exactly the pattern js-llm-chat uses for its
 * Anthropic key. tissue has no platform-managed AI gateway; Cells call
 * provider APIs directly with their own keys.
 *
 * Setup:
 *   ribo db create vec-search && ribo deploy
 *   curl -X POST http://localhost:8080/<addr>/configure -d '{"api_key":"sk-..."}'
 *
 * Routes:
 *   POST /configure        { api_key } — store the OpenAI API key in C3
 *   POST /documents        { title, body } — embed and store a document
 *   GET  /documents        — list all documents (without embeddings)
 *   GET  /search?q=...     — embed the query, rank stored docs by cosine distance
 */

const EMBEDDINGS_API = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const DDL = [
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // F32_BLOB(n) is libSQL's native fixed-width float32 vector column type.
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
      if (method === "POST" && parts[0] === "configure")  return await configure(DB, await json(request));
      if (method === "POST" && parts[0] === "documents")  return await createDocument(DB, env, await json(request));
      if (method === "GET"  && parts[0] === "documents")  return await listDocuments(DB);
      if (method === "GET"  && parts[0] === "search")     return await search(DB, env, url.searchParams.get("q"));

      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function configure(DB, body) {
  const apiKey = (body.api_key ?? "").trim();
  if (!apiKey) throw typed(400, "api_key is required");
  await DB.prepare(
    "INSERT INTO config (key, value) VALUES ('api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(apiKey).run();
  return Response.json({ ok: true });
}

async function createDocument(DB, env, body) {
  const title = (body.title ?? "").trim();
  const text  = (body.body ?? "").trim();
  if (!title || !text) throw typed(400, "title and body are required");

  const apiKey = await getApiKey(DB);
  const [embedding] = await embed(apiKey, [`${title}\n\n${text}`]);

  // vector32() takes a JSON array string and converts it to an F32_BLOB.
  // Binding a JS array serializes to exactly that JSON text — no manual
  // encoding needed. See plan-sqlite-vec.md Subject 1.
  const { results } = await DB.prepare(`
    INSERT INTO documents (title, body, embedding)
    VALUES (?, ?, vector32(?))
    RETURNING id, title, body, created_at
  `).bind(title, text, JSON.stringify(embedding)).all();

  return Response.json(results[0], { status: 201 });
}

async function listDocuments(DB) {
  // Never SELECT the embedding column directly — it renders as a wall of
  // byte integers. Distance functions are how you should ever touch it.
  const { results } = await DB.prepare(
    "SELECT id, title, body, created_at FROM documents ORDER BY id DESC"
  ).all();
  return Response.json(results);
}

async function search(DB, env, q) {
  if (!q || !q.trim()) throw typed(400, "?q= is required");

  const apiKey = await getApiKey(DB);
  const [queryEmbedding] = await embed(apiKey, [q]);

  // Brute-force cosine distance — an O(n) scan over BLOB comparisons inside
  // the SQLite engine. Plenty fast at Cell scale (hundreds–tens of thousands
  // of rows). Reach for libsql_vector_idx + vector_top_k only once
  // meta.duration_ms shows this scan actually costing something.
  const { results } = await DB.prepare(`
    SELECT
      id, title, body,
      vector_distance_cos(embedding, vector32(?)) AS distance
    FROM documents
    ORDER BY distance ASC
    LIMIT 10
  `).bind(JSON.stringify(queryEmbedding)).all();

  return Response.json({ query: q, results });
}

async function getApiKey(DB) {
  const { results } = await DB.prepare("SELECT value FROM config WHERE key = 'api_key'").all();
  if (!results[0]) throw typed(503, "API key not configured — POST /configure first");
  return results[0].value;
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
    <h1>Semantic search <span class="muted">(libSQL native vectors)</span></h1>
    <div class="row">
      <input id="q" placeholder="Describe what you're looking for…" autocomplete="off">
      <button onclick="doSearch()">Search</button>
    </div>
    <div id="results"></div>
    <p class="muted">Unlike keyword search, queries match by <em>meaning</em> — "how do I host my app" can match a document titled "deploying with ribo" even with no shared words. POST documents via <code>/documents</code> first.</p>
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
    : '<p class="muted">No documents yet — POST some to /documents.</p>';
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
