/**
 * js-llm-chat — stateless LLM chat using the Anthropic API, standard Request/Response API.
 *
 * Setup:
 *   ribo vault set llm-chat ANTHROPIC_API_KEY
 *   openssl rand -hex 32 | ribo vault set llm-chat ACCESS_TOKEN
 *   ribo deploy
 *
 * Routes:
 *   POST /chat         { message, model?, system?, max_tokens? } → { reply, model, usage }   (Bearer ACCESS_TOKEN)
 *   GET  /             usage info
 */

const ANTHROPIC_API      = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL      = "claude-haiku-4-5-20251001";
const MODELS             = new Set([DEFAULT_MODEL, "claude-sonnet-4-6", "claude-opus-4-7"]);
const DEFAULT_MAX_TOKENS = 1024;
const MAX_TOKENS_CAP     = 4096;
const MAX_MESSAGE_CHARS  = 20000;

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (method === "GET"  && parts.length === 0) return usage();
      if (method === "POST" && parts[0] === "chat") {
        await requireAccess(request, env);
        return await chat(env, await json(request));
      }
      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

// A vault value that was never set arrives as this placeholder.
const VAULT_UNSET = "***REMOVED***";
const isSet = (v) => typeof v === "string" && v !== "" && v !== VAULT_UNSET;

// Every route that spends the API key needs ACCESS_TOKEN as a Bearer header.
// With no token stored the Cell refuses everyone rather than running open.
async function requireAccess(request, env) {
  if (!isSet(env.ACCESS_TOKEN)) throw typed(503, "ACCESS_TOKEN is not set: ribo vault set llm-chat ACCESS_TOKEN");
  const h = request.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.ACCESS_TOKEN].map((v) => crypto.subtle.digest("SHA-256", enc.encode(v))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  if (!given || diff !== 0) throw typed(401, "unauthorized");
}

function apiKey(env) {
  if (!isSet(env.ANTHROPIC_API_KEY)) throw typed(503, "ANTHROPIC_API_KEY is not set: ribo vault set llm-chat ANTHROPIC_API_KEY");
  return env.ANTHROPIC_API_KEY;
}

async function chat(env, body) {
  const { message, model = DEFAULT_MODEL, system, max_tokens = DEFAULT_MAX_TOKENS } = body;
  if (typeof message !== "string" || !message) throw typed(400, "message is required");
  if (message.length > MAX_MESSAGE_CHARS) throw typed(400, `message must be at most ${MAX_MESSAGE_CHARS} characters`);
  if (system != null && (typeof system !== "string" || system.length > MAX_MESSAGE_CHARS)) throw typed(400, "system must be a short string");
  if (!MODELS.has(model)) throw typed(400, `model must be one of ${[...MODELS].join(", ")}`);
  if (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS_CAP) {
    throw typed(400, `max_tokens must be 1-${MAX_TOKENS_CAP}`);
  }

  const reqBody = {
    model, max_tokens,
    messages: [{ role: "user", content: message }],
    ...(system ? { system } : {}),
  };

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(env),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(reqBody),
  });

  const data = await res.json();
  if (!res.ok) throw typed(res.status, data.error?.message ?? "Anthropic API error");

  return ok({ reply: data.content?.[0]?.text ?? "", model: data.model, usage: data.usage });
}

function usage() {
  return ok({
    routes: {
      "POST /chat": "{ message, model?, system?, max_tokens? } with Authorization: Bearer <ACCESS_TOKEN>",
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
