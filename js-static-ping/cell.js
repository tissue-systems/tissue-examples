const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tissue Cell</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 4rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    p  { color: #555; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
    .ping-box { margin-top: 2rem; padding: 1rem; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; }
    button { margin-top: 0.75rem; padding: 0.5rem 1.25rem; background: #222; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #444; }
    pre { margin-top: 0.75rem; background: #111; color: #eee; padding: 0.75rem; border-radius: 6px; font-size: 0.85rem; white-space: pre-wrap; min-height: 2.5rem; }
  </style>
</head>
<body>
  <h1>Tissue Cell</h1>
  <p>Static page + <code>GET /api/ping</code> endpoint.</p>
  <div class="ping-box">
    <strong>Try the ping API:</strong>
    <button onclick="ping()">Ping</button>
    <pre id="out">—</pre>
  </div>
  <script>
    async function ping() {
      const out = document.getElementById('out');
      out.textContent = 'loading…';
      try {
        const r = await fetch('/api/ping');
        const j = await r.json();
        out.textContent = JSON.stringify(j, null, 2);
      } catch (e) {
        out.textContent = 'error: ' + e.message;
      }
    }
  </script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/ping") {
      return Response.json({
        pong: true,
        timestamp: new Date().toISOString(),
        method: request.method,
      });
    }

    // Everything else → static HTML
    return new Response(HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
