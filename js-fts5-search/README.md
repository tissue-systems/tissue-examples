# js-fts5-search

Keyword full-text search over notes using SQLite's **FTS5** module.

FTS5 ships in every standard SQLite build, including the libSQL engine that
powers c3, so there's nothing to enable. This example exists as a canonical
reference for the "external content" FTS5 pattern: a virtual table that
indexes another table's columns without duplicating storage, kept in sync
with triggers.

This is the keyword search half. Its sibling,
[`js-vec-search`](../js-vec-search), does semantic search.

## What it shows

- `CREATE VIRTUAL TABLE ... USING fts5(..., content='notes', content_rowid='id')`
  indexing an existing table without copying its data
- `AFTER INSERT/UPDATE/DELETE` triggers that keep the FTS index in sync
- `MATCH` queries ranked by `bm25()` (SQLite's relevance scoring)
- `snippet()` for highlighted excerpts around matches, with control-character
  markers that are swapped for `<mark>` only after the text is HTML-escaped
- Quoting and prefix-matching (`"word"*`) so arbitrary user input is safe to
  pass into FTS5's query syntax

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/notes` | `{ title, body }` | Create a note (needs `WRITE_TOKEN`) |
| `GET` | `/notes` | — | List all notes, newest first |
| `DELETE` | `/notes/:id` | — | Delete a note (needs `WRITE_TOKEN`) |
| `GET` | `/search?q=...` | — | Ranked keyword search with highlighted excerpts |
| `GET` | `/` | — | Search UI |

## Deploy

```bash
ribo db create fts5-search
openssl rand -hex 32 | ribo vault set fts5-search WRITE_TOKEN
ribo deploy
```

Writes need the token as a Bearer header; search and the UI are public. Until
`WRITE_TOKEN` is set, writes answer 503.

## Try it

```bash
URL=https://fts5-search.<your-subdomain>.tissue.dev
AUTH="Authorization: Bearer $WRITE_TOKEN"

curl -X POST $URL/notes -H "$AUTH" -d '{"title":"Garage fork","body":"We mirror Garage from deuxfleurs-org for supply chain control and version pinning."}'
curl -X POST $URL/notes -H "$AUTH" -d '{"title":"Pulse scheduler","body":"Pulse polls rqlite every 30 seconds and dispatches due schedules to your Cell."}'

curl "$URL/search?q=schedule"
# matches "schedules" via stemmed/prefix matching, with a highlighted excerpt
```
