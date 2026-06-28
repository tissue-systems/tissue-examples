# js-fts5-search

Keyword full-text search over notes using SQLite's **FTS5** module.

FTS5 ships in every standard SQLite build, including the libSQL engine that
powers c3 — there's nothing to enable. This example exists as a canonical
reference for the "external content" FTS5 pattern: a virtual table that
indexes another table's columns without duplicating storage, kept in sync
with triggers.

See [`plan-sqlite-vec.md`](../../plans/plan-sqlite-vec.md) for the broader
context — this is the "keyword search" half of that plan; its sibling
[`js-vec-search`](../js-vec-search) is the "semantic search" half.

## What it shows

- `CREATE VIRTUAL TABLE ... USING fts5(..., content='notes', content_rowid='id')`
  — indexing an existing table without copying its data
- `AFTER INSERT/UPDATE/DELETE` triggers that keep the FTS index in sync
- `MATCH` queries ranked by `bm25()` (SQLite's relevance scoring)
- `snippet()` for highlighted excerpts around matches
- Quoting and prefix-matching (`"word"*`) so arbitrary user input is safe to
  pass into FTS5's query syntax

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/notes` | `{ title, body }` | Create a note |
| `GET` | `/notes` | — | List all notes, newest first |
| `DELETE` | `/notes/:id` | — | Delete a note |
| `GET` | `/search?q=...` | — | Ranked keyword search with highlighted excerpts |
| `GET` | `/` | — | Search UI |

## Deploy

```bash
ribo db create fts5-search
ribo deploy
```

## Try it

```bash
URL=http://localhost:8080/<addr>

curl -X POST $URL/notes -d '{"title":"Garage fork","body":"We mirror Garage from deuxfleurs-org for supply chain control and version pinning."}'
curl -X POST $URL/notes -d '{"title":"Pulse scheduler","body":"Pulse polls rqlite every 30 seconds and dispatches due schedules to workerd."}'

curl "$URL/search?q=schedule"
# matches "schedules" via stemmed/prefix matching, with a highlighted excerpt
```
