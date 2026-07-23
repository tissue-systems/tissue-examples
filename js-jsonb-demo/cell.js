/**
 * js-jsonb-demo — showing off SQLite JSONB in tissue c3.
 *
 * c3 is backed by libSQL (SQLite), so it has the full JSON1 + JSONB toolkit.
 * JSONB (SQLite >= 3.45) stores JSON as a parsed BINARY tree instead of text:
 *   - smaller on disk (no whitespace, compact varint headers)
 *   - json_extract / ->> read the binary tree directly (no re-parse per call)
 *   - jsonb_set / jsonb_insert / jsonb_remove mutate a nested field in place,
 *     returning a new blob — no read-modify-write of the whole doc in JS
 *   - -> returns JSONB (chainable); ->> returns the SQL scalar
 *
 * This cell stores the SAME product catalog two ways in one table — a TEXT
 * `doc_text` column and a BINARY `doc` JSONB column — then runs live queries
 * that highlight where JSONB pulls ahead of hand-rolled JSON-in-TEXT.
 *
 * Routes:
 *   GET /            — HTML report (runs every demo below and renders it)
 *   GET /api/report  — the same results as JSON
 *   GET /api/seed    — (re)seed the catalog
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id       INTEGER PRIMARY KEY,
    -- exact same document, stored two ways:
    doc_text TEXT NOT NULL,   -- plain JSON text (what you'd do without JSONB)
    doc      BLOB NOT NULL    -- JSONB binary tree
  );
`;

// A generated expression index over a nested JSONB field. Filtering products
// by category no longer scans+reparses every row — SQLite reads the binary
// tree and probes this B-tree.
const INDEX = `
  CREATE INDEX IF NOT EXISTS idx_products_category
    ON products ( doc ->> '$.category' );
`;

// Rich, nested catalog documents — arrays, nested objects, mixed types.
const CATALOG = [
  {
    id: 1, name: "Aurora Keyboard", category: "peripherals", price: 129.0,
    inStock: true, tags: ["mechanical", "wireless", "rgb"],
    specs: { switch: "brown", layout: "75%", battery_mah: 4000, connectivity: ["bt", "usb-c", "2.4ghz"] },
    reviews: [{ user: "kim", stars: 5 }, { user: "lee", stars: 4 }, { user: "ada", stars: 5 }],
  },
  {
    id: 2, name: "Nimbus Mouse", category: "peripherals", price: 59.0,
    inStock: false, tags: ["wireless", "ergonomic"],
    specs: { dpi: 26000, buttons: 8, battery_mah: 500, connectivity: ["bt", "2.4ghz"] },
    reviews: [{ user: "ravi", stars: 4 }, { user: "sol", stars: 3 }],
  },
  {
    id: 3, name: "Halo 27 Monitor", category: "displays", price: 449.0,
    inStock: true, tags: ["4k", "hdr", "usb-c"],
    specs: { panel: "ips", hz: 144, nits: 400, ports: { hdmi: 2, dp: 1, usbc: 1 } },
    reviews: [{ user: "min", stars: 5 }, { user: "jo", stars: 5 }],
  },
  {
    id: 4, name: "Slate Desk Mat", category: "accessories", price: 24.5,
    inStock: true, tags: ["felt", "large"],
    specs: { material: "wool-felt", size: "900x400mm" },
    reviews: [{ user: "eve", stars: 4 }],
  },
  {
    id: 5, name: "Beacon Webcam", category: "peripherals", price: 89.0,
    inStock: true, tags: ["1080p", "usb-c", "privacy-shutter"],
    specs: { resolution: "1080p", fps: 60, mic: true, connectivity: ["usb-c"] },
    reviews: [{ user: "tom", stars: 3 }, { user: "ana", stars: 4 }, { user: "rex", stars: 2 }],
  },
];

async function seed(env) {
  await env.DB.exec(SCHEMA);
  await env.DB.exec("DELETE FROM products;");
  // Insert once per row: the TEXT column gets JSON.stringify (with indenting,
  // like a human-authored blob), the JSONB column gets jsonb(?) of the compact
  // form. SQLite parses the text into its binary tree at write time.
  for (const p of CATALOG) {
    const pretty = JSON.stringify(p, null, 2);   // "wasteful" but realistic text JSON
    const compact = JSON.stringify(p);
    await env.DB
      .prepare("INSERT INTO products (id, doc_text, doc) VALUES (?, ?, jsonb(?))")
      .bind(p.id, pretty, compact)
      .run();
  }
  await env.DB.exec(INDEX);
}

// Each demo returns { title, blurb, sql, rows }. The SQL is shown to the reader
// so the JSONB features are visible, not hidden behind the app.
async function runDemos(env) {
  const demos = [];
  const q = async (title, blurb, sql) => {
    const { results } = await env.DB.prepare(sql).all();
    demos.push({ title, blurb, sql: sql.trim(), rows: results });
  };

  // 1. Storage footprint — binary JSONB vs the text it came from.
  await q(
    "1 · Storage footprint",
    "The identical document as TEXT vs JSONB. JSONB drops whitespace and " +
    "stores a compact binary tree, so it is smaller on disk — and that is the " +
    "same bytes SQLite reads at query time.",
    `SELECT
        json_extract(doc, '$.name')      AS product,
        length(doc_text)                 AS text_bytes,
        length(doc)                      AS jsonb_bytes,
        length(doc_text) - length(doc)   AS saved_bytes,
        printf('%.0f%%',
          100.0 * (length(doc_text) - length(doc)) / length(doc_text)) AS saved
     FROM products
     ORDER BY id`
  );

  // 2. Extraction without re-parsing — ->> reads the binary tree directly.
  await q(
    "2 · Nested extraction (no re-parse)",
    "With TEXT JSON every json_extract() re-parses the whole string. Over JSONB, " +
    "-> / ->> walk the binary tree directly. Here we pull scalars from three " +
    "nesting levels in one pass.",
    `SELECT
        doc ->> '$.name'              AS product,
        doc ->> '$.specs.battery_mah' AS battery,
        doc ->> '$.specs.connectivity[0]' AS primary_link,
        doc ->> '$.reviews[0].user'   AS first_reviewer
     FROM products
     WHERE doc ->> '$.specs.battery_mah' IS NOT NULL
     ORDER BY battery DESC`
  );

  // 3. Indexed filter on a nested field — uses idx_products_category.
  await q(
    "3 · Indexed filter on a nested key",
    "The expression index over doc->>'$.category' means this filter is a B-tree " +
    "probe, not a full scan that reparses every document.",
    `SELECT doc ->> '$.name' AS product, doc ->> '$.price' AS price
     FROM products
     WHERE doc ->> '$.category' = 'peripherals'
     ORDER BY price DESC`
  );

  // 3b. Prove the index is actually used.
  await q(
    "3b · Query plan (index in use)",
    "EXPLAIN QUERY PLAN confirms SQLite uses idx_products_category rather than " +
    "scanning + reparsing every row.",
    `EXPLAIN QUERY PLAN
       SELECT doc ->> '$.name' FROM products
       WHERE doc ->> '$.category' = 'peripherals'`
  );

  // 4. Unnest arrays with json_each over a JSONB path — tag popularity.
  await q(
    "4 · Unnest arrays (json_each over JSONB)",
    "json_each explodes the tags array of every product into rows so we can " +
    "GROUP BY across the whole catalog — a join/aggregate you cannot express " +
    "against opaque JSON text.",
    `SELECT tag.value AS tag, COUNT(*) AS products
     FROM products, json_each(products.doc, '$.tags') AS tag
     GROUP BY tag.value
     ORDER BY products DESC, tag`
  );

  // 5. Aggregate over nested arrays — average star rating per product.
  await q(
    "5 · Aggregate over nested objects",
    "json_each walks each product's reviews array; avg() rolls the nested star " +
    "ratings up per product. The nesting stays queryable.",
    `SELECT
        p.doc ->> '$.name'                    AS product,
        COUNT(*)                              AS reviews,
        printf('%.2f', avg(r.value ->> '$.stars')) AS avg_stars
     FROM products p, json_each(p.doc, '$.reviews') AS r
     GROUP BY p.id
     ORDER BY avg_stars DESC`
  );

  // 6. In-place partial mutation — no read-modify-write in JS.
  //    Restock #2, bump its price 10%, and append a tag, all in one UPDATE.
  await q(
    "6 · In-place partial mutation",
    "jsonb_set / jsonb_insert edit nested fields inside the stored blob in a " +
    "single UPDATE — no SELECT, JSON.parse, mutate, JSON.stringify, UPDATE " +
    "round-trip in application code.",
    `UPDATE products
        SET doc = jsonb_insert(
                    jsonb_set(
                      jsonb_set(doc, '$.inStock', json('true')),
                      '$.price', round((doc ->> '$.price') * 1.10, 2)),
                    '$.tags[#]', 'restocked')
      WHERE id = 2
      RETURNING
        doc ->> '$.name'    AS product,
        doc ->> '$.inStock' AS in_stock,
        doc ->> '$.price'   AS new_price,
        json(doc -> '$.tags') AS tags`
  );

  // 7. Reshape a JSONB doc into a new JSON object — projection.
  await q(
    "7 · Reshape into a new object",
    "json_object + JSONB accessors project a trimmed view — pick nested fields, " +
    "compute a derived one, and hand back clean JSON to the client.",
    `SELECT json_object(
        'sku',      'P' || printf('%03d', id),
        'title',    doc ->> '$.name',
        'link',     doc ->> '$.specs.connectivity[0]',
        'cheap',    json(iif(doc ->> '$.price' < 100, 'true', 'false'))
     ) AS card
     FROM products
     ORDER BY id`
  );

  return demos;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Seed on demand (and lazily on first hit if the table is empty).
    if (path === "/api/seed") {
      await seed(env);
      return Response.json({ ok: true, seeded: CATALOG.length });
    }

    // Reseed on every render so the report is deterministic and idempotent —
    // demo 6 performs a persistent mutation, so a fresh catalog each request
    // keeps the shown numbers stable across reloads.
    await seed(env);
    const demos = await runDemos(env);

    if (path === "/api/report") {
      return Response.json({ demos }, { headers: { "cache-control": "no-store" } });
    }

    return new Response(renderHtml(demos), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  },
};

/* ---------- rendering ---------- */

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderTable(rows) {
  if (!rows.length) return `<p class="empty">no rows</p>`;
  const cols = Object.keys(rows[0]);
  const head = cols.map(c => `<th>${esc(c)}</th>`).join("");
  const body = rows.map(r =>
    `<tr>${cols.map(c => {
      let v = r[c];
      if (v && typeof v === "object") v = JSON.stringify(v);
      return `<td>${esc(v ?? "")}</td>`;
    }).join("")}</tr>`
  ).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderHtml(demos) {
  const sections = demos.map(d => `
    <section class="demo">
      <h2>${esc(d.title)}</h2>
      <p class="blurb">${esc(d.blurb)}</p>
      <pre class="sql">${esc(d.sql)}</pre>
      <div class="scroll">${renderTable(d.rows)}</div>
    </section>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JSONB in tissue c3</title>
<style>
  :root{
    --bg:#0f1117; --panel:#171a22; --line:#262b36; --ink:#e7ebf2;
    --muted:#9aa4b6; --accent:#7cd1f7; --green:#addcb9; --ring:#00b57e;
    --code:#0b0d12;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);
    color:var(--ink);line-height:1.5;padding:2.5rem 1.25rem 4rem}
  .wrap{max-width:920px;margin:0 auto}
  header{margin-bottom:2.5rem}
  .mark{display:flex;gap:.55rem;align-items:center;margin-bottom:1.1rem}
  .mark svg{width:34px;height:34px}
  .mark b{font-size:1.05rem;letter-spacing:.02em}
  h1{font-size:1.9rem;line-height:1.15;margin-bottom:.6rem}
  h1 em{font-style:normal;color:var(--accent)}
  .lede{color:var(--muted);max-width:70ch}
  .lede code{background:var(--code);padding:.1em .4em;border-radius:4px;
    font-size:.85em;color:var(--green)}
  .demo{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:1.4rem 1.4rem 1.1rem;margin-top:1.5rem}
  h2{font-size:1.15rem;margin-bottom:.5rem;color:var(--green)}
  .blurb{color:var(--muted);margin-bottom:1rem;max-width:74ch;font-size:.95rem}
  pre.sql{background:var(--code);border:1px solid var(--line);border-radius:8px;
    padding:.9rem 1rem;overflow-x:auto;font:0.82rem/1.5 ui-monospace,Menlo,monospace;
    color:#cbd5e6;margin-bottom:1rem;white-space:pre}
  .scroll{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:.86rem}
  th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);
    white-space:nowrap}
  th{color:var(--accent);font-weight:600;font-size:.78rem;text-transform:uppercase;
    letter-spacing:.04em}
  td{color:#dbe2ee;font-variant-numeric:tabular-nums}
  tbody tr:last-child td{border-bottom:none}
  .empty{color:var(--muted);font-style:italic}
  footer{margin-top:2.5rem;color:var(--muted);font-size:.85rem;text-align:center}
  footer code{background:var(--code);padding:.1em .4em;border-radius:4px;color:var(--green)}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="mark">
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="22" cy="22" r="22" fill="#7cd1f7"/>
        <circle cx="78" cy="22" r="22" fill="#addcb9"/>
        <circle cx="22" cy="78" r="22" fill="#addcb9"/>
        <circle cx="78" cy="78" r="20" fill="none" stroke="#00b57e" stroke-width="4"/>
      </svg>
      <b>tissue · c3</b>
    </div>
    <h1>The full power of <em>JSONB</em></h1>
    <p class="lede">c3 is a SQL API backed by SQLite (libSQL), so it ships the whole
      JSON1 + <code>JSONB</code> toolkit. Every product below is stored twice in one
      table — once as plain JSON <code>TEXT</code>, once as a binary <code>JSONB</code>
      blob — and every query here runs live against c3. JSONB keeps documents smaller,
      lets <code>-&gt;&gt;</code> read nested fields without re-parsing, indexes nested
      keys, and mutates deep fields in place with <code>jsonb_set</code>.</p>
  </header>
  ${sections}
  <footer>
    Live on <a href="/api/report">/api/report</a> (JSON) ·
    reseed at <code>/api/seed</code> · powered by tissue c3
  </footer>
</div>
</body>
</html>`;
}
