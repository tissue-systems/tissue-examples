# ts-events-api

Typed events/calendar REST API written in TypeScript, compiled with `esbuild`, deployed as a JS Cell.

## Setup

```bash
npm install
ribo db create events
ribo deploy            # runs esbuild src/cell.ts → dist/cell.js, then uploads
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
```

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create schema + index (idempotent) |
| `GET` | `/events` | — | List all events; `?date=YYYY-MM-DD` to filter |
| `GET` | `/events/:id` | — | Get one event |
| `POST` | `/events` | `{ title, date, description? }` | Create event |
| `PATCH` | `/events/:id` | `{ title?, date?, description? }` | Update event |
| `DELETE` | `/events/:id` | — | Delete event |

`date` must be `YYYY-MM-DD`.

## Try it

```bash
URL=http://localhost:8080/<addr>

curl -X POST $URL/events -d '{"title":"Launch","date":"2026-06-01","description":"Ship it"}'
curl -X POST $URL/events -d '{"title":"Retro","date":"2026-06-08"}'

curl "$URL/events?date=2026-06-01"
curl -X PATCH $URL/events/1 -d '{"description":"Ship it for real this time"}'
curl -X DELETE $URL/events/2
```

## What this demonstrates

- TypeScript → JS compilation as a `ribo.toml` build step (no Makefile, no CI config)
- Type-safe `C3Database` interface matching the C3 client's actual return shapes
- `esbuild` for fast, dependency-free bundling: `src/cell.ts` → single `dist/cell.js`
- The build output (`dist/cell.js`) is what gets uploaded — the TS source never leaves the machine
