/**
 * js-hello — minimal Tissue Cell using the standard Workers API.
 *
 * Routes:
 *   GET  /               → { message, method, path }
 *   GET  /hello/:name    → { greeting }
 *   POST /echo           → echoes the request body
 */

export default {
  async fetch(request, env, ctx) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && parts.length === 0) {
      return Response.json({ message: "Hello from Tissue!", method, path: url.pathname });
    }

    if (method === "GET" && parts[0] === "hello" && parts[1]) {
      return Response.json({ greeting: `Hello, ${parts[1]}!` });
    }

    if (method === "POST" && parts[0] === "echo") {
      const body = await request.text();
      return Response.json({ echo: tryJson(body) ?? body });
    }

    return Response.json({ error: `No route for ${method} ${url.pathname}` }, { status: 404 });
  },
};

function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
