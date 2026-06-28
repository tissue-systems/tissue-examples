# js-vec-search

Semantic ("meaning-based") search over documents using **libSQL's native
vector type and distance functions** — `F32_BLOB` columns, `vector32()`,
and `vector_distance_cos()`.

**This is not the `sqlite-vec` extension.** libSQL (the SQLite fork that
powers c3) has its own built-in vector support compiled directly into the
SQL engine — no extension loading, no new c3 dependencies, nothing to build.
See [`plan-sqlite-vec.md`](../../plans/plan-sqlite-vec.md) for the full
reasoning on why that's the better fit for tissue, and how it compares to
keyword search in its sibling example, [`js-fts5-search`](../js-fts5-search).

## How it works

1. `POST /documents` sends the title + body to OpenAI's embeddings API,
   getting back a 1536-dimensional float vector that represents its meaning.
2. That vector is stored via `vector32(?)`, bound to a JSON-encoded JS array
   — libSQL parses the JSON text and packs it into an `F32_BLOB(1536)` column.
3. `GET /search?q=...` embeds the query the same way, then ranks every stored
   document by `vector_distance_cos(embedding, vector32(?))` — cosine
   distance between the query's meaning and each document's meaning.
4. Results are ordered by distance ascending: closer in meaning = more
   relevant, regardless of whether any words actually match.

This is the building block for retrieval-augmented generation (RAG),
recommendation engines, "find similar" features, and semantic search UIs.

## Why brute-force distance instead of an ANN index

At Cell scale (hundreds to low tens-of-thousands of documents), a full scan
comparing the query vector against every stored vector is fast — it's a
tight loop over BLOB comparisons inside the SQLite engine, not application
code. libSQL also supports approximate nearest-neighbor search via
`libsql_vector_idx` + `vector_top_k` for much larger corpora, but that's
extra complexity this example deliberately skips. Reach for it only once
`meta.duration_ms` on the brute-force query actually shows a problem.

## Bring your own embedding key

tissue has no platform-managed AI gateway — Cells call provider APIs
directly with keys the owner supplies. This example stores an OpenAI key in
c3 via `/configure`, the exact pattern [`js-llm-chat`](../js-llm-chat) uses
for its Anthropic key.

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/configure` | `{ api_key }` | Store the OpenAI API key |
| `POST` | `/documents` | `{ title, body }` | Embed and store a document |
| `GET` | `/documents` | — | List documents (embeddings omitted) |
| `GET` | `/search?q=...` | — | Semantic search ranked by cosine distance |
| `GET` | `/` | — | Search UI |

## Deploy

```bash
ribo db create vec-search
ribo deploy

URL=http://localhost:8080/<addr>
curl -X POST $URL/configure -d '{"api_key":"sk-..."}'
```

## Try it

```bash
curl -X POST $URL/documents -d '{
  "title": "Deploying with ribo",
  "body": "ribo deploy uploads your Cell code and gives it a live URL on tissue.systems."
}'
curl -X POST $URL/documents -d '{
  "title": "g7 object storage",
  "body": "g7 wraps Garage to give Cells an S3-compatible bucket API without talking to Garage directly."
}'

curl "$URL/search?q=how+do+I+host+my+app"
# matches "Deploying with ribo" — note no shared words with the query;
# the match is on meaning, found via vector_distance_cos, not keyword overlap
```
