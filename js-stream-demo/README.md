# js-stream-demo

Minimal JS Cell showing that request and response bodies are live
`ReadableStream`s, not buffered JSON. No database, no bindings.

## Deploy

```bash
ribo deploy
# deployed  stream-demo
# address   <addr>
# url       http://localhost:8080/<addr>
```

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Usage info |
| `GET` | `/sse` | Server-Sent Events — 5 ticks, 500ms apart |
| `POST` | `/echo` | Streams the request body back unchanged (full duplex) |
| `POST` | `/count` | Reads the request body incrementally → `{ bytes, chunks }` |

## Try it

```bash
URL=http://localhost:8080/<addr>

# Watch ticks arrive one at a time, ~500ms apart, over ~2 seconds.
curl -N $URL/sse

# Pass-through: response starts streaming back before the upload finishes.
curl -N -X POST --data-binary @some-large-file $URL/echo -o copy-of-file

# Incremental read: bytes/chunks are tallied as the body arrives.
curl -X POST --data-binary @some-large-file $URL/count
```

## What this demonstrates

- A Cell's `fetch(request, env, ctx)` receives the standard Workers `Request`
  object. `request.body` is a `ReadableStream` — `/count` reads it chunk by
  chunk via `getReader()` instead of waiting for `request.text()` /
  `request.arrayBuffer()` to buffer the whole thing.
- A Cell can return `new Response(stream, ...)` and the body streams to the
  client as it's produced. `/sse` enqueues one chunk every 500ms; `/echo`
  pipes `request.body` straight into the response with no buffering at all.
- This applies to **JS Cells only**. WASM Cells cross the JS/WASM boundary as
  a single JSON string (`{ method, url, headers, body }` in,
  `{ status, headers, body }` out), so request and response bodies are fully
  buffered for those — see [Cell Limitations](https://tissue.systems/docs/cells/limitations/).
