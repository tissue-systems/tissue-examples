/**
 * js-ai-agent — stateful AI agent with C3-persisted conversation memory.
 * Standard Request/Response API.
 *
 * Setup:
 *   ribo db create agent
 *   ribo vault set agent ANTHROPIC_API_KEY
 *   openssl rand -hex 32 | ribo vault set agent ACCESS_TOKEN
 *   ribo deploy
 *   curl -X POST -H "Authorization: Bearer $ACCESS_TOKEN" https://agent.<sub>.tissue.dev/init
 *
 * Every route needs `Authorization: Bearer <ACCESS_TOKEN>`. The API key is a
 * vault binding and the system prompt a text binding, so neither is writable
 * over HTTP.
 *
 * Routes:
 *   POST /init                       create schema
 *   POST /sessions                   create session → { session_id }
 *   GET  /sessions                   list sessions
 *   POST /sessions/:id/message       { content } → { reply, session_id, turn }
 *   GET  /sessions/:id/history       conversation history
 *   DELETE /sessions/:id             clear session messages
 */

const ANTHROPIC_API  = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL  = "claude-haiku-4-5-20251001";
const DEFAULT_SYSTEM = "You are a helpful assistant. Be concise and clear.";
const MAX_TOKENS     = 2048;
const MAX_CONTENT    = 20000;
// Older turns past this are left out of the replay so one session can't grow
// into an unbounded request.
const MAX_HISTORY    = 50;
const SESSION_RE     = /^[0-9a-f]{16}$/;

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      await requireAccess(request, env);
      if (parts[0] === "sessions" && parts[1] && !SESSION_RE.test(parts[1])) return err(404, "session not found");
      if (method === "POST"   && parts[0] === "init")       return await init(DB);
      if (method === "POST"   && parts[0] === "sessions" && !parts[1])              return await createSession(DB);
      if (method === "GET"    && parts[0] === "sessions" && !parts[1])              return await listSessions(DB);
      if (method === "POST"   && parts[0] === "sessions" && parts[2] === "message") return await sendMessage(DB, env, parts[1], await json(request));
      if (method === "GET"    && parts[0] === "sessions" && parts[2] === "history") return await getHistory(DB, parts[1]);
      if (method === "DELETE" && parts[0] === "sessions" &&  parts[1])             return await clearSession(DB, parts[1]);
      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function init(DB) {
  await DB.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await DB.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await DB.exec("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)");
  return ok({ ok: true, message: "agent schema ready" });
}

// A vault value that was never set arrives as this placeholder.
const VAULT_UNSET = "***REMOVED***";
const isSet = (v) => typeof v === "string" && v !== "" && v !== VAULT_UNSET;

// Every route that spends the API key needs ACCESS_TOKEN as a Bearer header.
// With no token stored the Cell refuses everyone rather than running open.
async function requireAccess(request, env) {
  if (!isSet(env.ACCESS_TOKEN)) throw typed(503, "ACCESS_TOKEN is not set: ribo vault set agent ACCESS_TOKEN");
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
  if (!isSet(env.ANTHROPIC_API_KEY)) throw typed(503, "ANTHROPIC_API_KEY is not set: ribo vault set agent ANTHROPIC_API_KEY");
  return env.ANTHROPIC_API_KEY;
}
async function createSession(DB) {
  const id = randomId();
  await DB.prepare("INSERT INTO sessions (id) VALUES (?)").bind(id).run();
  return ok({ session_id: id }, 201);
}

async function listSessions(DB) {
  const { results } = await DB.prepare(
    "SELECT s.id, s.created_at, s.updated_at, COUNT(m.id) as turns " +
    "FROM sessions s LEFT JOIN messages m ON m.session_id = s.id " +
    "GROUP BY s.id ORDER BY s.updated_at DESC"
  ).all();
  return ok({ sessions: results });
}

async function sendMessage(DB, env, sessionId, body) {
  const { content } = body;
  if (typeof content !== "string" || !content) throw typed(400, "content is required");
  if (content.length > MAX_CONTENT) throw typed(400, `content must be at most ${MAX_CONTENT} characters`);
  const session = await DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) throw typed(404, `Session ${sessionId} not found`);

  const key = apiKey(env);
  const systemPrompt = env.SYSTEM_PROMPT || DEFAULT_SYSTEM;

  const { results: recent } = await DB.prepare(
    "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).bind(sessionId, MAX_HISTORY).all();
  const history = recent.reverse();
  // The API wants the replay to open with a user turn.
  while (history.length && history[0].role !== "user") history.shift();

  await DB.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)")
    .bind(sessionId, content).run();

  const messages = [...history, { role: "user", content }];

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
  });

  const data = await res.json();
  if (!res.ok) throw typed(res.status, data.error?.message ?? "Anthropic API error");

  const reply = data.content?.[0]?.text ?? "";
  await DB.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)")
    .bind(sessionId, reply).run();
  await DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?")
    .bind(sessionId).run();

  return ok({ reply, session_id: sessionId, turn: messages.length });
}

async function getHistory(DB, sessionId) {
  const session = await DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return err(404, `Session ${sessionId} not found`);
  const { results } = await DB.prepare(
    "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id"
  ).bind(sessionId).all();
  return ok({ session_id: sessionId, messages: results, turns: Math.floor(results.length / 2) });
}

async function clearSession(DB, sessionId) {
  const session = await DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return err(404, `Session ${sessionId} not found`);
  const { results } = await DB.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE session_id = ?"
  ).bind(sessionId).all();
  await DB.prepare("DELETE FROM messages WHERE session_id = ?").bind(sessionId).run();
  await DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").bind(sessionId).run();
  return ok({ cleared: sessionId, messages_deleted: results[0]?.count ?? 0 });
}

function randomId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function json(req) {
  const text = await req.text();
  if (!text) throw typed(400, "request body required");
  try { return JSON.parse(text); } catch { throw typed(400, "invalid JSON body"); }
}

function typed(code, message) { const e = new Error(message); e.status = code; return e; }
function ok(data, status = 200) { return Response.json(data, { status }); }
function err(status, message) { return Response.json({ error: message }, { status }); }
