/**
 * js-ai-agent — stateful AI agent with C3-persisted conversation memory.
 * Standard Workers API.
 *
 * Setup:
 *   ribo db create agent && ribo deploy
 *   curl -X POST http://localhost:8080/<addr>/init
 *   curl -X POST http://localhost:8080/<addr>/configure -d '{"api_key":"sk-ant-..."}'
 *
 * Routes:
 *   POST /init                       create schema
 *   POST /configure                  { api_key, system_prompt? }
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

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      if (method === "POST"   && parts[0] === "init")       return await init(DB);
      if (method === "POST"   && parts[0] === "configure")  return await configure(DB, await json(request));
      if (method === "POST"   && parts[0] === "sessions" && !parts[1])              return await createSession(DB);
      if (method === "GET"    && parts[0] === "sessions" && !parts[1])              return await listSessions(DB);
      if (method === "POST"   && parts[0] === "sessions" && parts[2] === "message") return await sendMessage(DB, parts[1], await json(request));
      if (method === "GET"    && parts[0] === "sessions" && parts[2] === "history") return await getHistory(DB, parts[1]);
      if (method === "DELETE" && parts[0] === "sessions" &&  parts[1])             return await clearSession(DB, parts[1]);
      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e) {
      return err(e.status ?? 500, e.message);
    }
  },
};

async function init(DB) {
  await DB.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
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

async function configure(DB, body) {
  const { api_key, system_prompt } = body;
  if (!api_key) throw typed(400, "api_key is required");
  await DB.prepare("INSERT OR REPLACE INTO config VALUES ('api_key', ?)").bind(api_key).run();
  if (system_prompt) {
    await DB.prepare("INSERT OR REPLACE INTO config VALUES ('system_prompt', ?)").bind(system_prompt).run();
  }
  return ok({ ok: true, message: "configuration saved" });
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

async function sendMessage(DB, sessionId, body) {
  const { content } = body;
  if (!content) throw typed(400, "content is required");
  const session = await DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) throw typed(404, `Session ${sessionId} not found`);

  const apiKey = await cfg(DB, "api_key");
  if (!apiKey) throw typed(503, "API key not configured — POST /configure first");
  const systemPrompt = await cfg(DB, "system_prompt") ?? DEFAULT_SYSTEM;

  const { results: history } = await DB.prepare(
    "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id"
  ).bind(sessionId).all();

  await DB.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)")
    .bind(sessionId, content).run();

  const messages = [...history, { role: "user", content }];

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
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

async function cfg(DB, key) {
  const row = await DB.prepare("SELECT value FROM config WHERE key = ?").bind(key).first();
  return row?.value ?? null;
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
