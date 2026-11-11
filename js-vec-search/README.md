# js-vec-search

Semantic search over documents with c3's built-in vector support:
`F32_BLOB` columns, `vector32()` and `vector_distance_cos()`. They're part
of libSQL, the SQLite fork c3 runs on, so there's no extension to load.
For keyword search instead, see [`js-fts5-search`](../js-fts5-search).

The full reference, including the approximate index, is at
[tissue.systems/docs/c3/vector-search](https://tissue.systems/docs/c3/vector-search/).

## How it works

1. `POST /documents` sends the title and body to OpenAI's embeddings API and
   gets back 1536 numbers that stand for what the text means.
2. The Cell stores them with `vector32(?)`, binding the plain JS array.
   Parameters travel as JSON, which is the text form `vector32()` reads, and
   the column is an `F32_BLOB(1536)`.
3. `GET /search?q=...` embeds the query the same way and ranks every stored
   document by `vector_distance_cos(embedding, vector32(?))`.
4. Smaller distance means closer in meaning, whether or not any words match.

This is the retrieval half of retrieval-augmented generation (RAG), and the
same query gives you "find similar" and recommendations.

## Why a full scan and not the index

The search compares the query against every row. That's exact, and it takes
tens of milliseconds at tens of thousands of documents. c3 also has an
approximate index (`libsql_vector_idx` + `vector_top_k`), but it is several
times the size of the table, makes inserts slower, and has to be created
before the rows go in. Add it when `meta.duration_ms` on the search says to.

## Bring your own embedding key

Cells call model providers directly with the owner's key. This one reads it
from a `vault` binding, so the key is never in the code or the database.

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/documents` | `{ title, body }` | Embed and store a document |
| `GET` | `/documents` | | List documents (embeddings omitted) |
| `GET` | `/search?q=...` | | Semantic search ranked by cosine distance |
| `GET` | `/` | | Search page |

## Deploy

Set the key before the first deploy. A vault value that's missing at deploy
time leaves the binding without a usable key.

```bash
ribo db create vec-search
ribo vault set vec-search OPENAI_API_KEY
ribo deploy
```

`ribo deploy` prints the Cell's URL:

```bash
URL=https://vec-search.<your-subdomain>.tissue.dev
```

## Try it

```bash
curl -X POST $URL/documents -d '{
  "title": "Deploying with ribo",
  "body": "ribo deploy uploads your Cell code and gives it a live URL on tissue.systems."
}'
curl -X POST $URL/documents -d '{
  "title": "g7 object storage",
  "body": "g7 gives Cells an S3-compatible bucket API."
}'

curl "$URL/search?q=how+do+I+host+my+app"
# "Deploying with ribo" comes first with no words in common with the query
```
