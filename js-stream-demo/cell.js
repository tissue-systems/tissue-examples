/**
 * js-stream-demo — Cells get standard Workers Request/Response objects, so
 * bodies are live ReadableStreams in both directions: a Cell can start
 * responding before it has finished reading the request, and a client can
 * start receiving a response before the Cell has finished producing it.
 *
 * Routes:
 *   GET  /          → usage info
 *   GET  /sse       → Server-Sent Events, one tick every 500ms for 5 ticks
 *   POST /echo      → streams the request body straight back (full duplex)
 *   POST /count     → reads the request body incrementally → { bytes, chunks }
 */

export default {
  async fetch(request, env, ctx) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && parts.length === 0) return usage();
    if (method === "GET" && parts[0] === "sse") return sse();
    if (method === "POST" && parts[0] === "echo") return echo(request);
    if (method === "POST" && parts[0] === "count") return count(request);

    return Response.json({ error: `No route for ${method} ${url.pathname}` }, { status: 404 });
  },
};

// Generates a response body over time. The client receives each tick as it's
// enqueued, not all at once after the stream closes.
function sse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 1; i <= 5; i++) {
        const event = `data: ${JSON.stringify({ tick: i, time: new Date().toISOString() })}\n\n`;
        controller.enqueue(encoder.encode(event));
        if (i < 5) await sleep(500);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

// Passes the request body straight through as the response body. The Cell
// never holds the full body in memory — this works the same for 10 bytes or
// 10 GB.
function echo(request) {
  return new Response(request.body, {
    headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream" },
  });
}

// Reads the request body incrementally via its reader, tallying bytes and
// chunks as they arrive — proof the body is delivered as a live stream
// rather than buffered before fetch() is called.
async function count(request) {
  const reader = request.body.getReader();
  let bytes = 0;
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++;
    bytes += value.byteLength;
  }
  return Response.json({ bytes, chunks });
}

function usage() {
  return Response.json({
    routes: {
      "GET /sse": "Server-Sent Events — 5 ticks, 500ms apart",
      "POST /echo": "Streams the request body back unchanged (full duplex)",
      "POST /count": "Reads the request body incrementally → { bytes, chunks }",
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
