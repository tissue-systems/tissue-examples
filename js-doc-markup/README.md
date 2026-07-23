# js-doc-markup

Collaborative PDF markup between browser windows. A PDF stored in a g7
bucket is rendered in the browser (pdf.js); any number of windows join a
shared **3-letter session** and mark it up together:

- **Brush** — draw, circle, highlight on any page; strokes replicate live
- **Text** — click to drop a note; typing streams to every window keystroke
  by keystroke
- **Live cursors** — see where the other windows are pointing, per page

Visiting `/` creates a fresh session code and redirects to `/s/<code>`.
Other windows join by entering the code in the toolbar (or opening the same
URL). Annotations are scoped to the session and — as abuse control for a
public demo — **self-delete 15 minutes after the session's last edit**
(lazy sweep on page loads and stream opens).

Under the hood this is the js-live-canvas state model applied to a document:

- **Durable** (c3): `sessions`, `strokes`, `texts`. Coordinates are
  normalized to the page (`x,y ∈ [0,1]`), so differently-sized windows see
  annotations in the same document spot.
- **Ephemeral** (isolate-global Map): cursor positions — ~20 updates/sec per
  window, zero DB writes, same-edge only.
- **Delivery**: SSE + in-memory wake counters; same-edge pushes in ~25ms, a
  250ms c3 re-check covers writes from the other edge.
- **The PDF itself**: `GET /doc.pdf` streams the object from the g7 bucket
  binding (`env.DOCS.get(...)`) with an hour of cache.

Deploy:

```bash
ribo db create doc-markup                     # c3 dbs are not auto-created
ribo bucket create markup-docs
ribo bucket cp your.pdf markup-docs:nasa-ISSFD23_IN1_4.pdf   # or change PDF_KEY
ribo deploy
```
