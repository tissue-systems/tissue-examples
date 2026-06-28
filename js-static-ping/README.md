# js-static-ping

Static HTML page with a single JSON API endpoint. The simplest cell that serves both HTML and data.

## What it shows

- Serving an HTML page from a string template
- A `GET /api/ping` JSON endpoint
- Routing between HTML and API in a single `fetch` handler

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML page with a Ping button |
| `GET` | `/api/ping` | `{ pong: true, timestamp, method }` |

## Deploy

```bash
ribo deploy
```
