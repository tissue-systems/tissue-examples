# js-live-canvas

Two browser windows, one canvas. Open the page twice side by side: each
window gets a colored cursor the other can see moving live, and anything you
draw appears in the other window as you draw it. Refresh keeps the drawing;
Clear wipes it for everyone.

The point of the demo is the two kinds of shared state a Cell has:

- **Durable** — strokes are rows in a c3 table. New windows replay the full
  history on connect; the drawing survives refreshes and isolate restarts.
- **Ephemeral** — cursor positions live in a module-global `Map`. Isolate
  globals persist across requests on an edge, so ~25 cursor updates/sec per
  window cost zero database writes.

Delivery is SSE: every write bumps an in-memory counter; open streams check
it every 25ms and push only what changed, so same-edge latency is a few
milliseconds plus network. A 250ms c3 re-check picks up strokes written on
the other edge. Cursors are in-memory only and therefore **same-edge only** —
fine for two windows on one desk, and an honest illustration of what
per-edge isolate state does and doesn't give you.

Deploy:

```bash
ribo db create live-canvas   # the c3 binding does not auto-create the database
ribo deploy
```
