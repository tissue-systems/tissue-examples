# js-notes

Full CRUD notes API in plain JavaScript, backed by a C3 (libSQL) database.

## Setup

```bash
ribo db create notes
ribo deploy
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
```

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create schema (idempotent) |
| `GET` | `/notes` | — | List all notes, newest first |
| `GET` | `/notes/:id` | — | Get one note |
| `POST` | `/notes` | `{ title, body? }` | Create note |
| `PATCH` | `/notes/:id` | `{ title?, body? }` | Update note |
| `DELETE` | `/notes/:id` | — | Delete note |

## Try it

```bash
URL=http://localhost:8080/<addr>

curl -X POST $URL/notes -d '{"title":"Buy groceries","body":"milk, eggs"}'
curl -X POST $URL/notes -d '{"title":"Call dentist"}'
curl $URL/notes
curl -X PATCH $URL/notes/1 -d '{"body":"milk, eggs, bread"}'
curl -X DELETE $URL/notes/2
```

## What this demonstrates

- JS Cell as a complete self-contained API server
- C3 binding (`[[bindings]]` in `ribo.toml`) injected as `globalThis.env.DB`
- C3 prepared statements: `.prepare().bind().run()` / `.all()` / `.first()`
- Standard REST patterns: 201 on create, 404 on missing resource
