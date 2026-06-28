# js-c3-notes

Simple notes app demonstrating the C3 SQLite binding.

## What it shows

- Creating a C3 database and binding it to a cell
- `env.DB.prepare(sql).all()` — query
- `env.DB.prepare(sql).bind(...params).run()` — insert/delete
- Form-based UI with server-side redirects

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML page: note list + add form |
| `POST` | `/notes` | Create a note (form submit) |
| `POST` | `/notes/:id/delete` | Delete a note (form submit) |
| `GET` | `/api/notes` | JSON list of all notes |

## Deploy

Requires a C3 database binding. Create the database first:

```bash
ribo db create notes
ribo deploy
```

## ribo.toml

```toml
[cell]
name = "c3-notes"
js   = "./cell.js"

[[bindings]]
type     = "c3"
binding  = "DB"
database = "notes"
```
