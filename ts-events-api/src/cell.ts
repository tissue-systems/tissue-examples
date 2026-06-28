/**
 * ts-events-api — typed events/calendar API in TypeScript, standard Workers API.
 *
 * Setup:
 *   ribo db create events
 *   ribo deploy          (runs: esbuild src/cell.ts → dist/cell.js, then uploads)
 *   curl -X POST http://localhost:8080/<addr>/init
 *
 * Routes:
 *   POST   /init             create schema + index (idempotent)
 *   GET    /events           list events; ?date=YYYY-MM-DD to filter
 *   GET    /events/:id       get one event
 *   POST   /events           { title, date, description? }
 *   PATCH  /events/:id       { title?, date?, description? }
 *   DELETE /events/:id
 */

interface EventRow {
  id: number;
  title: string;
  date: string;
  description: string;
  created_at: string;
}

interface CreateBody { title: string; date: string; description?: string; }
interface UpdateBody { title?: string; date?: string; description?: string; }

interface C3PreparedStatement {
  bind(...values: unknown[]): C3PreparedStatement;
  run(): Promise<{ meta: { rows_affected: number; last_insert_rowid: number; duration_ms: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface C3Database {
  prepare(sql: string): C3PreparedStatement;
  exec(sql: string): Promise<unknown>;
}

interface Env { DB: C3Database; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { method } = request;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const DB = env.DB;

    try {
      if (method === "GET"    && parts.length === 0)                        return serveUI();
      if (method === "POST"   && parts[0] === "init")                       return await init(DB);
      if (method === "GET"    && parts[0] === "events" && !parts[1])        return await list(DB, url.searchParams.get("date"));
      if (method === "GET"    && parts[0] === "events" &&  parts[1])        return await getOne(DB, num(parts[1]));
      if (method === "POST"   && parts[0] === "events")                     return await create(DB, await parseBody<CreateBody>(request));
      if (method === "PATCH"  && parts[0] === "events" &&  parts[1])        return await update(DB, num(parts[1]), await parseBody<UpdateBody>(request));
      if (method === "DELETE" && parts[0] === "events" &&  parts[1])        return await remove(DB, num(parts[1]));
      return err(404, `No route for ${method} ${url.pathname}`);
    } catch (e: unknown) {
      const typed = e as Error & { status?: number };
      return err(typed.status ?? 500, typed.message);
    }
  },
};

async function init(DB: C3Database): Promise<Response> {
  await DB.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, date TEXT NOT NULL, description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await DB.exec("CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)");
  return ok({ ok: true, message: "events table ready" });
}

async function list(DB: C3Database, dateFilter: string | null): Promise<Response> {
  const stmt = dateFilter
    ? DB.prepare("SELECT * FROM events WHERE date = ? ORDER BY date, id").bind(dateFilter)
    : DB.prepare("SELECT * FROM events ORDER BY date, id");
  const { results } = await stmt.all<EventRow>();
  return ok({ events: results, count: results.length });
}

async function getOne(DB: C3Database, eventId: number): Promise<Response> {
  const row = await DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!row) return err(404, `Event ${eventId} not found`);
  return ok({ event: row });
}

async function create(DB: C3Database, body: CreateBody): Promise<Response> {
  const { title, date, description = "" } = body;
  if (!title) throw bad(400, "title is required");
  if (!date)  throw bad(400, "date is required (YYYY-MM-DD)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad(400, "date must be YYYY-MM-DD");
  await DB.prepare("INSERT INTO events (title, date, description) VALUES (?, ?, ?)").bind(title, date, description).run();
  const row = await DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 1").first<EventRow>();
  return ok({ event: row }, 201);
}

async function update(DB: C3Database, eventId: number, body: UpdateBody): Promise<Response> {
  const { title, date, description } = body;
  if (!title && !date && description === undefined) throw bad(400, "provide at least one field");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad(400, "date must be YYYY-MM-DD");
  const sets: string[] = [], params: unknown[] = [];
  if (title       !== undefined) { sets.push("title = ?");       params.push(title); }
  if (date        !== undefined) { sets.push("date = ?");        params.push(date); }
  if (description !== undefined) { sets.push("description = ?"); params.push(description); }
  params.push(eventId);
  const meta = await DB.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
  if (!meta?.meta?.rows_affected) return err(404, `Event ${eventId} not found`);
  const row = await DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  return ok({ event: row });
}

async function remove(DB: C3Database, eventId: number): Promise<Response> {
  const meta = await DB.prepare("DELETE FROM events WHERE id = ?").bind(eventId).run();
  if (!meta?.meta?.rows_affected) return err(404, `Event ${eventId} not found`);
  return ok({ deleted: eventId });
}

function num(s: string): number {
  const n = parseInt(s, 10);
  if (isNaN(n)) throw bad(400, `invalid id: ${s}`);
  return n;
}

async function parseBody<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) throw bad(400, "request body required");
  try { return JSON.parse(text) as T; } catch { throw bad(400, "invalid JSON body"); }
}

function bad(code: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = code;
  return e;
}

function serveUI(): Response {
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ts-events-api</title>
<style>
  *{box-sizing:border-box}
  body{font-family:monospace;background:#0d0d0d;color:#ccc;margin:0;padding:2rem;max-width:720px}
  h1{font-size:1.1rem;font-weight:500;color:#eee;margin:0 0 .4rem}
  .sub{font-size:.8rem;color:#555;margin-bottom:2rem}
  h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:#0066ff;margin:1.5rem 0 .5rem}
  table{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:1rem}
  th{text-align:left;color:#555;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;padding:.3rem .5rem;border-bottom:1px solid #1a1a1a}
  td{padding:.45rem .5rem;border-bottom:1px solid #111;vertical-align:top}
  .method{color:#33ff77;font-weight:500;white-space:nowrap}
  .path{color:#eee}
  .desc{color:#888}
  pre{background:#111;border:1px solid #1a1a1a;border-radius:4px;padding:.75rem 1rem;font-size:.78rem;color:#33ff77;overflow-x:auto;line-height:1.6}
  .note{font-size:.75rem;color:#555;margin-top:2rem}
</style></head><body>
<h1>ts-events-api</h1>
<p class="sub">Typed events/calendar REST API — TypeScript compiled with esbuild.</p>
<h2>Setup</h2>
<pre>curl -X POST /init</pre>
<h2>Routes</h2>
<table>
  <thead><tr><th>method</th><th>path</th><th>description</th></tr></thead>
  <tbody>
    <tr><td class="method">POST</td><td class="path">/init</td><td class="desc">Create schema (idempotent)</td></tr>
    <tr><td class="method">GET</td><td class="path">/events</td><td class="desc">List events; ?date=YYYY-MM-DD to filter</td></tr>
    <tr><td class="method">GET</td><td class="path">/events/:id</td><td class="desc">Get one event</td></tr>
    <tr><td class="method">POST</td><td class="path">/events</td><td class="desc">{ title, date, description? }</td></tr>
    <tr><td class="method">PATCH</td><td class="path">/events/:id</td><td class="desc">{ title?, date?, description? }</td></tr>
    <tr><td class="method">DELETE</td><td class="path">/events/:id</td><td class="desc">Delete event</td></tr>
  </tbody>
</table>
<h2>Try it</h2>
<pre>URL=${`${typeof location !== 'undefined' ? location.origin : ''}`}

curl -X POST $URL/init
curl -X POST $URL/events -d '{"title":"Launch","date":"2026-06-01"}'
curl "$URL/events?date=2026-06-01"</pre>
<p class="note">Source: <a href="https://github.com/ki7dk/tissue-examples/tree/main/ts-events-api" style="color:#0066ff">github.com/ki7dk/tissue-examples/ts-events-api</a></p>
</body></html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}

function ok(data: unknown, status = 200): Response { return Response.json(data, { status }); }
function err(status: number, message: string): Response { return Response.json({ error: message }, { status }); }
