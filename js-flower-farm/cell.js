/**
 * cell.js — Meadowlark Farm dynamic homepage
 *
 * What this cell does that a static file host cannot:
 *   • Reads live flower availability from C3 on every request
 *   • Accepts POST /notify → writes waitlist entries to C3
 *   • Accepts POST /stock  → farm admin updates availability
 *   • Accepts GET  /admin/waitlist → exports signups as JSON
 *   • Falls through to FILES for CSS, images, and other pages
 *
 * ribo.toml: js = "cell.js"  +  c3 DB binding  +  FILES binding
 */

// ── Flower catalogue (canonical order, id matches stock table) ────────────────

const FLOWERS = [
  {
    id:   'lavender',
    name: 'Lavender',
    img:  '/images/lavender.jpg',
    alt:  'Fresh lavender bundles tied with twine',
    desc: 'Grosso and Hidcote varieties, cut that morning. Fragrant fresh, even better dried.',
  },
  {
    id:   'sunflowers',
    name: 'Sunflowers',
    img:  '/images/sunflowers.jpg',
    alt:  'Sunflower field at golden hour',
    desc: 'Tall stems in classic yellow and deep burgundy. Autumn Beauty and Moulin Rouge — 10-day vase life.',
  },
  {
    id:   'dahlias',
    name: 'Dahlias',
    img:  '/images/dahlias.jpg',
    alt:  'Pink and coral dahlias in full bloom',
    desc: 'Dinner-plate and ball varieties in pink, coral, and burgundy. 42 varieties — something different every week.',
  },
];

// ── Database setup ────────────────────────────────────────────────────────────

// Module-level promise: ensureTables runs exactly once per isolate.
// Concurrent requests that arrive before setup completes all await the same
// promise instead of each launching their own DDL + seed writes, which would
// cause C3 lock contention and 500 errors.
let _setup = null;
function runSetup(db) {
  if (!_setup) {
    _setup = ensureTables(db).catch(() => {
      _setup = null; // reset so the next request retries setup
      // Don't rethrow — a transient C3 hiccup during setup (e.g. under burst
      // load on a cold isolate) must not 500 the whole request. The tables
      // are almost certainly already present; the actual query will tell us.
    });
  }
  return _setup;
}

async function ensureTables(db) {
  // Fast path: if the stock table already has rows, setup is complete.
  // This is a single read and returns immediately on every warm request.
  try {
    const { results } = await db.prepare('SELECT 1 FROM stock LIMIT 1').all();
    if (results.length > 0) return;
  } catch {
    // Table doesn't exist yet — fall through to first-time setup.
  }

  // First-time setup: create both tables and seed all rows in a single
  // batch request. One round trip instead of 8; C3 executes it atomically,
  // eliminating write-contention between concurrent cold-start requests.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS stock (
      flower   TEXT PRIMARY KEY,
      in_stock INTEGER NOT NULL DEFAULT 1,
      note     TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS waitlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      flowers    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    // Stock seeds — edit via POST /stock or ribo db exec.
    db.prepare('INSERT OR IGNORE INTO stock (flower, in_stock, note) VALUES (?, ?, ?)').bind('lavender',   1, null),
    db.prepare('INSERT OR IGNORE INTO stock (flower, in_stock, note) VALUES (?, ?, ?)').bind('sunflowers', 1, 'Last bundles of summer'),
    db.prepare('INSERT OR IGNORE INTO stock (flower, in_stock, note) VALUES (?, ?, ?)').bind('dahlias',    0, 'Back next week'),
    // Waitlist seeds — fixed negative IDs keep INSERT OR IGNORE idempotent.
    db.prepare('INSERT OR IGNORE INTO waitlist (id, email, flowers) VALUES (?, ?, ?)').bind(-1, 'sara@example.com',  'dahlias'),
    db.prepare('INSERT OR IGNORE INTO waitlist (id, email, flowers) VALUES (?, ?, ?)').bind(-2, 'james@example.com', 'dahlias,sunflowers'),
    db.prepare('INSERT OR IGNORE INTO waitlist (id, email, flowers) VALUES (?, ?, ?)').bind(-3, 'priya@example.com', 'lavender,dahlias'),
  ]);
}

async function getStock(db) {
  const { results } = await db.prepare(
    'SELECT flower, in_stock, note FROM stock'
  ).all();
  const map = {};
  for (const r of results) map[r.flower] = { inStock: !!r.in_stock, note: r.note };
  return map;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stockBadge(inStock, note) {
  const cls   = inStock ? 'stock-yes' : 'stock-no';
  const label = inStock ? '✓ Available this week' : 'Not this week';
  const extra = note ? ` — ${note}` : '';
  return `<span class="stock-badge ${cls}">${label}${extra}</span>`;
}

function flowerCard(f, stock) {
  const s   = stock[f.id] ?? { inStock: true, note: null };
  const dim = s.inStock ? '' : ' out-of-stock';
  return `
    <div class="flower-card${dim}">
      <div class="flower-img-wrap">
        <img src="${f.img}" alt="${f.alt}" loading="lazy">
      </div>
      <div class="flower-info">
        <h3>${f.name}</h3>
        ${stockBadge(s.inStock, s.note)}
        <p>${f.desc}</p>
      </div>
    </div>`;
}

function checkboxes() {
  return FLOWERS.map(f => `
    <label class="flower-check">
      <input type="checkbox" name="flowers" value="${f.id}">
      <span>${f.name}</span>
    </label>`).join('');
}

// ── Page template ─────────────────────────────────────────────────────────────

function renderHomepage(stock) {
  const cards = FLOWERS.map(f => flowerCard(f, stock)).join('');
  const allOut = FLOWERS.every(f => !(stock[f.id]?.inStock ?? true));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Meadowlark Farm — Cut Flowers · Sonoma County</title>
  <meta name="description" content="Fresh-cut flowers grown on our 12-acre farm in Petaluma, California. Find us at Sonoma County farmers markets every Saturday and Sunday.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>

  <header class="site-header">
    <nav class="nav-inner">
      <a href="/" class="logo">
        <span class="logo-name">Meadowlark Farm</span>
        <span class="logo-sub">Cut flowers · Sonoma County, CA</span>
      </a>
      <ul class="nav-links">
        <li><a href="/flowers.html">Flowers</a></li>
        <li><a href="/about.html">About</a></li>
        <li><a href="#markets">Markets</a></li>
      </ul>
    </nav>
  </header>

  <section class="hero">
    <img class="hero-img" src="/images/hero.jpg" alt="Meadowlark Farm flower fields in Sonoma County">
    <div class="hero-overlay">
      <div class="hero-content">
        <p class="hero-eyebrow">Petaluma, California · Est. 2009</p>
        <h1>Flowers grown<br>with honest hands</h1>
        <p class="hero-sub">Fresh-cut bouquets from our 12-acre family farm. Picked the morning of market, never refrigerated, never flown in.</p>
        <a href="#markets" class="btn-primary">Find us at market →</a>
      </div>
    </div>
  </section>

  <section class="in-season" id="blooming">
    <div class="container">
      <h2>What's blooming this week</h2>
      <p class="section-sub">Updated every Saturday morning before market.</p>
      ${allOut ? '<p class="section-sub out-of-season-note">We\'re between seasons — check back soon, or sign up below to be notified.</p>' : ''}
      <div class="flower-grid">${cards}</div>
      <div class="text-center">
        <a href="/flowers.html" class="btn-secondary">Full seasonal calendar →</a>
      </div>
    </div>
  </section>

  <section class="markets" id="markets">
    <div class="container">
      <div class="markets-inner">
        <div class="markets-text">
          <h2>Find us every weekend</h2>
          <p>We bring the farm to you. Look for the green-and-white striped tent and the smell of fresh lavender.</p>
          <div class="market-list">
            <div class="market-item">
              <div class="market-day">Sat</div>
              <div class="market-details">
                <strong>Petaluma East Side Farmers Market</strong>
                <span>Walnut Park · 2nd &amp; D St · 9 am – 1 pm</span>
              </div>
            </div>
            <div class="market-item">
              <div class="market-day">Sat</div>
              <div class="market-details">
                <strong>Marin Civic Center Market</strong>
                <span>San Rafael · Civic Center Drive · 8 am – 1 pm</span>
              </div>
            </div>
            <div class="market-item">
              <div class="market-day">Sun</div>
              <div class="market-details">
                <strong>Healdsburg Farmers Market</strong>
                <span>Plaza Street · North side · 9 am – noon</span>
              </div>
            </div>
          </div>
          <p class="market-note">Markets run April through October. Follow us on Instagram <strong>@meadowlarkfarm</strong> for weekly updates.</p>
        </div>
        <div class="markets-img">
          <img src="/images/market.jpg" alt="Meadowlark Farm booth at the Petaluma Farmers Market">
        </div>
      </div>
    </div>
  </section>

  <section class="bouquet-cta">
    <div class="container">
      <div class="bouquet-inner">
        <div class="bouquet-img">
          <img src="/images/bouquet.jpg" alt="A mixed seasonal bouquet wrapped in brown paper">
        </div>
        <div class="bouquet-text">
          <h2>Mixed bouquets, wrapped and ready</h2>
          <p>Every market day we bring pre-wrapped seasonal bouquets in three sizes, assembled that morning from whatever's at peak.</p>
          <ul class="bouquet-sizes">
            <li><strong>Small</strong> — a simple bunch for the kitchen table</li>
            <li><strong>Medium</strong> — a full mason-jar arrangement</li>
            <li><strong>Large</strong> — makes a real statement</li>
          </ul>
          <p>We also take custom orders for weddings and events — email us at least two weeks out.</p>
          <p class="farm-note">Cash and card accepted. No pre-orders for market day bouquets.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="newsletter" id="notify">
    <div class="container">
      <h2>Notify me when it's back</h2>
      <p>Pick the flowers you're after and leave your email — we'll send you a note the week they're available again.</p>
      <form class="notify-form" id="notify-form">
        <div class="flower-checks">${checkboxes()}</div>
        <div class="notify-row">
          <input type="email" name="email" placeholder="your@email.com" required autocomplete="email">
          <button type="submit" class="btn-submit">Notify me</button>
        </div>
        <p class="notify-status" id="notify-status" aria-live="polite"></p>
      </form>
    </div>
  </section>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="logo-name">Meadowlark Farm</span>
          <p>12 acres in Petaluma, California.<br>Family-run, certified naturally grown since 2009.</p>
        </div>
        <div class="footer-links">
          <a href="/flowers.html">Flowers</a>
          <a href="/about.html">About</a>
          <a href="#markets">Markets</a>
        </div>
        <div class="footer-contact">
          <p>Instagram: <a href="#">@meadowlarkfarm</a></p>
          <p><a href="mailto:hello@meadowlarkfarm.com">hello@meadowlarkfarm.com</a></p>
        </div>
      </div>
      <div class="footer-bottom">
        <p>Photos: <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a> · Hosted on <a href="https://tissue.systems" target="_blank" rel="noopener">tissue.systems</a></p>
      </div>
    </div>
  </footer>

  <script>
    document.getElementById('notify-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form   = e.target;
      const status = document.getElementById('notify-status');
      const btn    = form.querySelector('button[type=submit]');
      const data   = new URLSearchParams(new FormData(form));

      btn.disabled = true;
      btn.textContent = 'Sending…';
      status.className = 'notify-status';
      status.textContent = '';

      try {
        const res  = await fetch('/notify', { method: 'POST', body: data });
        const json = await res.json();
        if (res.ok) {
          status.textContent  = "✓ You're on the list — we'll be in touch!";
          status.className    = 'notify-status ok';
          form.reset();
          btn.textContent = 'Notify me';
        } else {
          status.textContent = json.error ?? 'Something went wrong.';
          status.className   = 'notify-status err';
          btn.disabled = false;
          btn.textContent = 'Notify me';
        }
      } catch {
        status.textContent = 'Network error — please try again.';
        status.className   = 'notify-status err';
        btn.disabled = false;
        btn.textContent = 'Notify me';
      }
    });
  </script>
</body>
</html>`;
}

// ── Admin page ────────────────────────────────────────────────────────────────

function renderAdminPage(stock, waitlist) {
  // Demand summary: count signups per flower
  const demand = {};
  for (const f of FLOWERS) demand[f.id] = 0;
  for (const row of waitlist) {
    for (const fid of row.flowers.split(',')) {
      const key = fid.trim();
      if (key in demand) demand[key]++;
    }
  }

  const stockRows = FLOWERS.map(f => {
    const s   = stock[f.id] ?? { inStock: true, note: null };
    const cls = s.inStock ? 'stock-yes' : 'stock-no';
    const lbl = s.inStock ? '✓ In stock' : '✗ Out';
    const note = s.note ? `<span class="admin-note">${s.note}</span>` : '';
    return `
      <tr>
        <td>${f.name}</td>
        <td><span class="stock-badge ${cls}">${lbl}</span></td>
        <td>${note}</td>
        <td class="demand-count">${demand[f.id]}</td>
      </tr>`;
  }).join('');

  const waitlistRows = waitlist.length === 0
    ? '<tr><td colspan="3" class="empty">No signups yet.</td></tr>'
    : waitlist.map(row => {
        const flowerNames = row.flowers.split(',')
          .map(fid => FLOWERS.find(f => f.id === fid.trim())?.name ?? fid.trim())
          .join(', ');
        const date = row.created_at.replace('T', ' ').slice(0, 16);
        return `
          <tr>
            <td class="admin-email">${row.email}</td>
            <td>${flowerNames}</td>
            <td class="admin-date">${date}</td>
          </tr>`;
      }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin — Meadowlark Farm</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .admin-wrap    { max-width: 860px; margin: 2.5rem auto; padding: 0 1.25rem 4rem; }
    .admin-back    { font-family: var(--font-body); font-size: .85rem; color: var(--green); text-decoration: none; }
    .admin-back:hover { text-decoration: underline; }
    .admin-section { margin-top: 2.5rem; }
    .admin-section h2 { font-family: var(--font-display); font-size: 1.5rem;
                        color: var(--text-dark); margin-bottom: 1rem; }
    .admin-table   { width: 100%; border-collapse: collapse; font-family: var(--font-body);
                     font-size: .9rem; }
    .admin-table th { text-align: left; padding: .45rem .75rem; border-bottom: 2px solid var(--border);
                      color: var(--text-light); font-weight: 700; font-size: .78rem;
                      text-transform: uppercase; letter-spacing: .04em; }
    .admin-table td { padding: .55rem .75rem; border-bottom: 1px solid var(--border);
                      color: var(--text-dark); vertical-align: middle; }
    .admin-table tr:last-child td { border-bottom: none; }
    .demand-count  { font-weight: 700; color: var(--green); text-align: right; }
    .admin-note    { color: var(--text-light); font-style: italic; }
    .admin-email   { font-weight: 400; }
    .admin-date    { color: var(--text-light); white-space: nowrap; }
    .admin-count   { font-family: var(--font-body); font-size: .9rem; color: var(--text-light);
                     margin-bottom: 1rem; }
    .empty         { color: var(--text-light); font-style: italic; padding: 1.25rem .75rem; }
  </style>
</head>
<body>
  <header class="site-header">
    <nav class="nav-inner">
      <a href="/" class="logo">
        <span class="logo-name">Meadowlark Farm</span>
        <span class="logo-sub">Cut flowers · Sonoma County, CA</span>
      </a>
    </nav>
  </header>

  <div class="admin-wrap">
    <a class="admin-back" href="/">← Back to site</a>

    <div class="admin-section">
      <h2>Current stock</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Flower</th>
            <th>Status</th>
            <th>Note</th>
            <th style="text-align:right">Waitlist</th>
          </tr>
        </thead>
        <tbody>${stockRows}</tbody>
      </table>
    </div>

    <div class="admin-section">
      <h2>Waitlist</h2>
      <p class="admin-count">${waitlist.length} signup${waitlist.length === 1 ? '' : 's'}</p>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Flowers</th>
            <th>Signed up</th>
          </tr>
        </thead>
        <tbody>${waitlistRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

// ── Fetch handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled error:', err);
      return new Response('Something went wrong — please try again.', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

async function handleRequest(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    await runSetup(env.DB);

    // ── GET / — dynamic homepage with live stock ──────────────────────────────
    if (method === 'GET' && path === '/') {
      // Degrade gracefully if C3 is momentarily unavailable — render the page
      // with an empty stock map so flower cards fall back to their default state.
      let stock = {};
      try { stock = await getStock(env.DB); } catch { /* use empty fallback */ }
      return new Response(renderHomepage(stock), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // ── POST /notify — waitlist signup ────────────────────────────────────────
    if (method === 'POST' && path === '/notify') {
      const ct = request.headers.get('content-type') ?? '';
      let email, flowers;

      if (ct.includes('application/json')) {
        const body = await request.json();
        email   = String(body.email ?? '').trim();
        flowers = Array.isArray(body.flowers) ? body.flowers.join(',') : String(body.flowers ?? '');
      } else {
        const params = new URLSearchParams(await request.text());
        email   = params.get('email')?.trim() ?? '';
        flowers = params.getAll('flowers').join(',');
      }

      if (!email || !email.includes('@')) {
        return Response.json({ error: 'A valid email address is required.' }, { status: 400 });
      }
      if (!flowers) {
        return Response.json({ error: 'Select at least one flower.' }, { status: 400 });
      }

      await env.DB.prepare(
        'INSERT INTO waitlist (email, flowers) VALUES (?, ?)'
      ).bind(email, flowers).run();

      return Response.json({ ok: true });
    }

    // ── POST /stock — update availability (farm admin) ────────────────────────
    if (method === 'POST' && path === '/stock') {
      const secret = env.STOCK_SECRET;
      if (secret) {
        const auth = request.headers.get('authorization') ?? '';
        if (auth !== `Bearer ${secret}`) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 });
        }
      }

      const updates = await request.json();
      const list    = Array.isArray(updates) ? updates : [updates];
      let   count   = 0;

      for (const u of list) {
        if (!u.flower) continue;
        await env.DB.prepare(`
          INSERT INTO stock (flower, in_stock, note) VALUES (?, ?, ?)
          ON CONFLICT(flower) DO UPDATE SET in_stock=excluded.in_stock, note=excluded.note
        `).bind(u.flower, u.inStock ? 1 : 0, u.note ?? null).run();
        count++;
      }

      return Response.json({ ok: true, updated: count });
    }

    // ── GET /admin — internal dashboard (stock + waitlist) ───────────────────
    if (method === 'GET' && path === '/admin') {
      const [stock, { results: waitlist }] = await Promise.all([
        getStock(env.DB),
        env.DB.prepare(
          'SELECT id, email, flowers, created_at FROM waitlist WHERE id > 0 ORDER BY id DESC'
        ).all(),
      ]);
      return new Response(renderAdminPage(stock, waitlist), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // ── GET /admin/waitlist — list signups as JSON ────────────────────────────
    if (method === 'GET' && path === '/admin/waitlist') {
      const secret = env.STOCK_SECRET;
      if (secret) {
        const auth = request.headers.get('authorization') ?? '';
        if (auth !== `Bearer ${secret}`) {
          return Response.json({ error: 'Unauthorized.' }, { status: 401 });
        }
      }
      const { results } = await env.DB.prepare(
        'SELECT id, email, flowers, created_at FROM waitlist ORDER BY id DESC'
      ).all();
      return Response.json(results);
    }

    // ── Everything else: CSS, images, other pages via FILES ───────────────────
    return env.FILES.fetch(request);
}
