/**
 * js-c3-notes — simple notes app demonstrating the c3 SQLite binding.
 *
 * Routes:
 *   GET  /          — HTML page: list notes + add form
 *   POST /notes     — create a note (form submit, redirects back)
 *   POST /notes/:id/delete — delete a note (form submit, redirects back)
 *   GET  /api/notes — JSON list of all notes
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )
`;

export default {
  async fetch(request, env) {
    await env.DB.exec(SCHEMA);

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/notes
    if (request.method === "GET" && path === "/api/notes") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM notes ORDER BY id DESC"
      ).all();
      return Response.json(results);
    }

    // POST /notes
    if (request.method === "POST" && path === "/notes") {
      const form = await request.formData();
      const body = (form.get("body") ?? "").toString().trim();
      if (body) {
        await env.DB.prepare(
          "INSERT INTO notes (body, created_at) VALUES (?, ?)"
        ).bind(body, new Date().toISOString()).run();
      }
      return Response.redirect(new URL("/", request.url).toString(), 303);
    }

    // POST /notes/:id/delete
    const deleteMatch = path.match(/^\/notes\/(\d+)\/delete$/);
    if (request.method === "POST" && deleteMatch) {
      const id = parseInt(deleteMatch[1], 10);
      await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
      return Response.redirect(new URL("/", request.url).toString(), 303);
    }

    // GET / — HTML UI
    const { results: notes } = await env.DB.prepare(
      "SELECT * FROM notes ORDER BY id DESC"
    ).all();

    const rows = notes.length
      ? notes.map(n => `
        <li class="note">
          <span>${escHtml(n.body)}</span>
          <form method="POST" action="/notes/${n.id}/delete" style="display:inline">
            <button class="del" type="submit">×</button>
          </form>
          <time>${n.created_at.slice(0, 16).replace("T", " ")}</time>
        </li>`).join("")
      : `<li class="empty">No notes yet — add one above.</li>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notes</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; padding: 2rem 1rem }
    .card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.1); max-width: 560px; margin: 0 auto; padding: 1.5rem }
    h1 { font-size: 1.4rem; margin-bottom: 1.2rem; color: #111 }
    .add-form { display: flex; gap: .5rem; margin-bottom: 1.5rem }
    .add-form input { flex: 1; padding: .55rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem }
    .add-form button { padding: .55rem 1rem; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem }
    ul { list-style: none }
    .note { display: flex; align-items: center; gap: .6rem; padding: .7rem 0; border-bottom: 1px solid #f0f0f0 }
    .note span { flex: 1 }
    .note time { font-size: .78rem; color: #999; white-space: nowrap }
    .del { background: none; border: none; cursor: pointer; font-size: 1.1rem; color: #bbb; line-height: 1 }
    .del:hover { color: #e00 }
    .empty { color: #999; padding: .7rem 0; font-size: .9rem }
    .api-link { margin-top: 1.2rem; font-size: .78rem; color: #999 }
    .api-link a { color: #666 }
  </style>
</head>
<body>
  <div class="card">
    <h1>Notes <span style="font-weight:400;color:#999;font-size:.9rem">(c3 SQLite)</span></h1>
    <form class="add-form" method="POST" action="/notes">
      <input name="body" placeholder="Add a note…" autocomplete="off" required>
      <button type="submit">Add</button>
    </form>
    <ul>${rows}</ul>
    <p class="api-link">JSON: <a href="/api/notes">/api/notes</a></p>
  </div>
</body>
</html>`;

    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
