/**
 * js-llm-chat — stateless LLM chat using Anthropic API, standard Workers API.
 *
 * Setup:
 *   ribo db create llm-chat && ribo deploy
 *   curl -X POST http://localhost:8080/<addr>/init
 *   curl -X POST http://localhost:8080/<addr>/configure -d '{"api_key":"sk-ant-..."}'
 *
 * Routes:
 *   POST /init         create config table
 *   POST /configure    { api_key } — store in C3
 *   POST /chat         { message, model?, system?, max_tokens? } → { reply, model, usage }
 *   GET  /             usage info
 */

const ANTHROPIC_API    = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL    = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      if (method === "POST" && parts[0] === "init")      return await init(DB);
      if (method === "POST" && parts[0] === "configure") return await configure(DB, await json(request));
      if (method === "POST" && parts[0] === "chat")      return await chat(DB, await json(request));
      if (method === "GET"  && parts.length === 0)       return usage();
      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function init(DB) {
  await DB.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return ok({ ok: true, message: "config table ready — POST /configure with your api_key" });
}

async function configure(DB, body) {
  const { api_key } = body;
  if (!api_key) throw typed(400, "api_key is required");
  if (!api_key.startsWith("sk-ant-")) throw typed(400, "expected an Anthropic API key (sk-ant-...)");
  await DB.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('api_key', ?)").bind(api_key).run();
  return ok({ ok: true, message: "API key stored" });
}

async function chat(DB, body) {
  const { message, model = DEFAULT_MODEL, system, max_tokens = DEFAULT_MAX_TOKENS } = body;
  if (!message) throw typed(400, "message is required");

  const apiKey = await getConfig(DB, "api_key");
  if (!apiKey) throw typed(503, "API key not configured — POST /configure first");

  const reqBody = {
    model, max_tokens,
    messages: [{ role: "user", content: message }],
    ...(system ? { system } : {}),
  };

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(reqBody),
  });

  const data = await res.json();
  if (!res.ok) throw typed(res.status, data.error?.message ?? "Anthropic API error");

  return ok({ reply: data.content?.[0]?.text ?? "", model: data.model, usage: data.usage });
}

async function getConfig(DB, key) {
  const row = await DB.prepare("SELECT value FROM config WHERE key = ?").bind(key).first();
  return row?.value ?? null;
}

function usage() {
  return ok({
    routes: {
      "POST /init": "create config table",
      "POST /configure": "{ api_key }",
      "POST /chat": "{ message, model?, system?, max_tokens? }",
    },
    models: { fast: DEFAULT_MODEL, balanced: "claude-sonnet-4-6", best: "claude-opus-4-7" },
  });
}

async function json(req) {
  const text = await req.text();
  if (!text) throw typed(400, "request body required");
  try { return JSON.parse(text); } catch { throw typed(400, "invalid JSON body"); }
}

function typed(code, message) { const e = new Error(message); e.status = code; return e; }
function ok(data, status = 200) { return Response.json(data, { status }); }
function err(status, message) { return Response.json({ error: message }, { status }); }
