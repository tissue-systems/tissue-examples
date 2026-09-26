// Data tour. Every run works inside its own rows (keyed by a fresh run id) and
// deletes them at the end, so concurrent runs don't see each other's data.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tour_items (
  id     INTEGER PRIMARY KEY,
  run    TEXT NOT NULL,
  name   TEXT NOT NULL,
  qty    INTEGER NOT NULL CHECK (qty >= 0),
  attrs  TEXT,
  UNIQUE (run, name)
);
CREATE VIRTUAL TABLE IF NOT EXISTS tour_docs USING fts5(run UNINDEXED, body);
`;

// What a vault binding holds when the deploy ran before `ribo vault set`.
const VAULT_PLACEHOLDER = "***REMOVED***";

async function check(name, fn) {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (err) {
    return { name, ok: false, detail: String(err && err.message || err) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function selftest(env) {
  const db = env.DB;
  const run = crypto.randomUUID();
  const checks = [];

  checks.push(await check("exec schema", async () => {
    const { meta } = await db.exec(SCHEMA);
    return meta;
  }));

  checks.push(await check("prepare + bind + run", async () => {
    const { meta } = await db.prepare("INSERT INTO tour_items (run, name, qty, attrs) VALUES (?, ?, ?, ?)")
      .bind(run, "apple", 3, JSON.stringify({ colour: "red", tags: ["fruit"] })).run();
    assert(meta.rows_affected === 1, `rows_affected ${meta.rows_affected}`);
    assert(meta.last_insert_rowid > 0, `last_insert_rowid ${meta.last_insert_rowid}`);
    return meta;
  }));

  checks.push(await check("batch commits together", async () => {
    const res = await db.batch([
      db.prepare("INSERT INTO tour_items (run, name, qty) VALUES (?, ?, ?)").bind(run, "pear", 5),
      db.prepare("INSERT INTO tour_items (run, name, qty) VALUES (?, ?, ?)").bind(run, "plum", 7),
      db.prepare("SELECT COUNT(*) AS n FROM tour_items WHERE run = ?").bind(run),
    ]);
    assert(res.length === 3, `${res.length} results`);
    assert(res[2].results[0].n === 3, `select inside batch saw ${res[2].results[0].n}`);
    return "3 statements, select saw both inserts";
  }));

  checks.push(await check("batch rolls back on error", async () => {
    let threw = false;
    try {
      await db.batch([
        db.prepare("UPDATE tour_items SET qty = qty + 100 WHERE run = ? AND name = 'pear'").bind(run),
        // Violates UNIQUE (run, name), so the whole batch must roll back.
        db.prepare("INSERT INTO tour_items (run, name, qty) VALUES (?, 'apple', 1)").bind(run),
      ]);
    } catch {
      threw = true;
    }
    assert(threw, "batch with a failing statement did not reject");
    const qty = await db.prepare("SELECT qty FROM tour_items WHERE run = ? AND name = 'pear'").bind(run).first("qty");
    assert(qty === 5, `pear qty ${qty}, the UPDATE was kept`);
    return "rejected, UPDATE rolled back";
  }));

  checks.push(await check("all", async () => {
    const { results } = await db.prepare("SELECT name, qty FROM tour_items WHERE run = ? ORDER BY name").bind(run).all();
    assert(results.map((r) => r.name).join(",") === "apple,pear,plum", JSON.stringify(results));
    return results;
  }));

  checks.push(await check("first + first(column)", async () => {
    const row = await db.prepare("SELECT SUM(qty) AS total, COUNT(*) AS n FROM tour_items WHERE run = ?").bind(run).first();
    const total = await db.prepare("SELECT SUM(qty) AS total FROM tour_items WHERE run = ?").bind(run).first("total");
    assert(row.total === 15 && total === 15, `${JSON.stringify(row)} / ${total}`);
    const none = await db.prepare("SELECT 1 FROM tour_items WHERE run = ? AND name = 'kiwi'").bind(run).first();
    assert(none === null, "first() on no rows should be null");
    return row;
  }));

  checks.push(await check("raw", async () => {
    const rows = await db.prepare("SELECT name, qty FROM tour_items WHERE run = ? ORDER BY qty").bind(run).raw();
    assert(Array.isArray(rows[0]) && rows[0][0] === "apple", JSON.stringify(rows));
    return rows;
  }));

  checks.push(await check("JSON functions", async () => {
    const colour = await db.prepare("SELECT json_extract(attrs, '$.colour') AS c FROM tour_items WHERE run = ? AND name = 'apple'")
      .bind(run).first("c");
    assert(colour === "red", `colour ${colour}`);
    return colour;
  }));

  checks.push(await check("CHECK constraint error surfaces", async () => {
    try {
      await db.prepare("INSERT INTO tour_items (run, name, qty) VALUES (?, 'negative', -1)").bind(run).run();
    } catch (err) {
      return String(err.message || err).slice(0, 120);
    }
    throw new Error("insert with qty -1 succeeded");
  }));

  checks.push(await check("bind types (null, float, blob)", async () => {
    const row = await db.prepare("SELECT ? AS n, ? AS f, typeof(?) AS t, length(?) AS len")
      .bind(null, 1.5, new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])).first();
    assert(row.n === null && row.f === 1.5 && row.t === "blob" && row.len === 3, JSON.stringify(row));
    return row;
  }));

  checks.push(await check("FTS5 match", async () => {
    await db.batch([
      db.prepare("INSERT INTO tour_docs (run, body) VALUES (?, ?)").bind(run, "cells run in V8 isolates"),
      db.prepare("INSERT INTO tour_docs (run, body) VALUES (?, ?)").bind(run, "objects live in buckets"),
    ]);
    const { results } = await db.prepare("SELECT body FROM tour_docs WHERE tour_docs MATCH ? AND run = ?")
      .bind("isolates", run).all();
    assert(results.length === 1, JSON.stringify(results));
    return results[0].body;
  }));

  checks.push(await check("cleanup", async () => {
    const res = await db.batch([
      db.prepare("DELETE FROM tour_items WHERE run = ?").bind(run),
      db.prepare("DELETE FROM tour_docs WHERE run = ?").bind(run),
    ]);
    return `${res[0].meta.rows_affected} items, ${res[1].meta.rows_affected} docs`;
  }));

  checks.push(await check("vault secret is set", async () => {
    const s = env.TOUR_SECRET;
    assert(typeof s === "string" && s.length > 0, "TOUR_SECRET is not set (run ribo vault set, then redeploy)");
    assert(s !== VAULT_PLACEHOLDER, "TOUR_SECRET is the placeholder: the deploy ran before ribo vault set");
    return `${s.length} characters`;
  }));

  checks.push(await check("vault secret signs", async () => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.TOUR_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(run));
    return `${sig.byteLength}-byte HMAC`;
  }));

  return checks;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/selftest") {
      const checks = await selftest(env);
      const ok = checks.every((c) => c.ok);
      return Response.json({ cell: "tour-data", ok, checks }, { status: ok ? 200 : 503 });
    }
    return new Response("tour-data: /selftest\n");
  },
};
