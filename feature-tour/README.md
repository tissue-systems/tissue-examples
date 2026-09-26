# feature-tour

Three Cells that between them touch every binding type and most of the runtime,
plus a runner that checks them from the outside. Use them to confirm an
environment works after a release: deploy, run `smoke.mjs`, read the failures.

| Cell | Covers |
|---|---|
| `storage/` (tour-storage) | g7 put/get/head/list/delete with text and binary bodies, a FILES tree (`get`, `fetch`, 404), a text binding, a once-a-minute pulse, and a `/hook` route for a vesicle endpoint |
| `realtime/` (tour-realtime) | server-sent events, a WebSocket echo, a streamed request body echoed back without buffering, outbound fetch, Web Crypto, gzip streams, `ctx.waitUntil` |
| `data/` (tour-data) | c3 `exec`, `prepare`/`bind`, `run`, `all`, `first`, `raw`, `batch` commit and rollback, JSON functions, FTS5, constraint errors, blob and null binds, and a vault secret used as an HMAC key |

Every Cell answers `GET /selftest` with `{ ok, checks: [{ name, ok, detail }] }`,
200 when every check passes and 503 otherwise.

## Deploy

```bash
ribo bucket create tour-storage
(cd storage  && ribo deploy)
(cd realtime && ribo deploy)

ribo db create tour-data
ribo vault set tour-data TOUR_SECRET     # before the deploy, or the Cell gets a placeholder
(cd data && ribo deploy)

# Optional: a vesicle endpoint that delivers to tour-storage's /hook
ribo vesicle endpoint create tour-hook --cell tour-storage --route /hook --ack on-success
```

## Check

```bash
node smoke.mjs \
  storage=https://tour-storage.<sub>.tissue.dev \
  realtime=https://tour-realtime.<sub>.tissue.dev \
  data=https://tour-data.<sub>.tissue.dev
```

The pulse check fails for the first minute after the first deploy, until the
scheduler has fired once.
