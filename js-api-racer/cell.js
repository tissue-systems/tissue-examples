/**
 * js-api-racer — fans out to multiple public APIs in parallel from the tissue edge,
 * measures per-API latency, and streams results back as newline-delimited JSON.
 *
 * Routes:
 *   GET  /          → HTML dashboard page
 *   GET  /race      → NDJSON stream: one JSON line per API result as it arrives
 *   GET  /race/json → Full JSON response after all APIs complete
 */

const APIS = [
  {
    id: "github-zen",
    label: "GitHub Zen",
    url: "https://api.github.com/zen",
    headers: { "User-Agent": "tissue-cell/1.0" },
    extract: (text) => ({ quote: text.trim() }),
  },
  {
    id: "jsonplaceholder",
    label: "JSONPlaceholder",
    url: "https://jsonplaceholder.typicode.com/todos/1",
    headers: {},
    extract: (text) => { const d = JSON.parse(text); return { title: d.title }; },
  },
  {
    id: "dog-api",
    label: "Dog CEO",
    url: "https://dog.ceo/api/breeds/image/random",
    headers: {},
    extract: (text) => { const d = JSON.parse(text); return { breed: d.message?.split("/")[4] ?? "??" }; },
  },
  {
    id: "chuck-norris",
    label: "Chuck Norris API",
    url: "https://api.chucknorris.io/jokes/random",
    headers: {},
    extract: (text) => { const d = JSON.parse(text); return { joke: d.value?.slice(0, 80) }; },
  },
  {
    id: "open-meteo",
    label: "Open-Meteo",
    url: "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m",
    headers: {},
    extract: (text) => { const d = JSON.parse(text); return { temp_c: d.current?.temperature_2m }; },
  },
  {
    id: "httpbin-uuid",
    label: "httpbin UUID",
    url: "https://httpbin.org/uuid",
    headers: {},
    extract: (text) => { const d = JSON.parse(text); return { uuid: d.uuid?.slice(0, 18) + "…" }; },
  },
];

async function raceOne(api, batchStart) {
  const t0 = Date.now();
  try {
    const res = await fetch(api.url, {
      headers: { ...api.headers, "accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    const data = api.extract(text);
    return { id: api.id, label: api.label, ok: true, status: res.status, ms, data, offset_ms: t0 - batchStart };
  } catch (err) {
    return { id: api.id, label: api.label, ok: false, ms: Date.now() - t0, error: String(err), offset_ms: t0 - batchStart };
  }
}

async function runRace() {
  const start = Date.now();
  const results = await Promise.all(APIS.map(api => raceOne(api, start)));
  const total_ms = Date.now() - start;
  const sum_ms = results.reduce((s, r) => s + r.ms, 0);
  return { results, total_ms, sum_ms, parallelism_factor: (sum_ms / total_ms).toFixed(1) };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Racer — tissue cell</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    :root {
      --bg: #0a0a0a; --bg2: #0e0e0e; --border: #1e1e1e;
      --text: #e8e8e8; --sub: #555; --green: #33ff77; --red: #ff4444;
      --yellow: #ffd700; --font: 'JetBrains Mono', monospace;
    }
    body {
      background: var(--bg); color: var(--text);
      font-family: var(--font); min-height: 100dvh;
      display: flex; flex-direction: column; align-items: center;
      padding: 2.5rem 1.5rem; gap: 2rem;
    }
    .top { text-align: center }
    h1 { font-size: 1.4rem; font-weight: 400; letter-spacing: -0.02em; color: var(--green) }
    .sub { font-size: 0.78rem; color: var(--sub); margin-top: 0.4rem; line-height: 1.6; max-width: 460px }
    button {
      background: var(--green); color: #0a0a0a; border: none;
      border-radius: 6px; font-family: var(--font); font-size: 0.85rem;
      font-weight: 700; padding: 0.6rem 2rem; cursor: pointer;
      transition: opacity 0.1s;
    }
    button:hover { opacity: 0.85 }
    button:disabled { opacity: 0.4; cursor: default }
    .board {
      width: 100%; max-width: 640px;
    }
    .api-row {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border);
      font-size: 0.82rem;
      opacity: 0.35;
      transition: opacity 0.2s;
    }
    .api-row.done { opacity: 1 }
    .api-row.error { opacity: 0.6 }
    .api-label { flex: 1; font-weight: 500 }
    .api-data { flex: 2; color: var(--sub); font-size: 0.74rem; word-break: break-all }
    .api-ms { font-size: 0.78rem; text-align: right; min-width: 55px }
    .ms-fast { color: var(--green) }
    .ms-ok   { color: var(--yellow) }
    .ms-slow { color: var(--red) }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0 }
    .dot-wait { background: #2a2a2a }
    .dot-ok   { background: var(--green) }
    .dot-err  { background: var(--red) }
    .summary {
      margin-top: 1rem; padding: 1rem 0.9rem;
      border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.78rem; display: none;
    }
    .summary.show { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem }
    .stat-label { color: var(--sub) }
    .stat-val { color: var(--green); font-weight: 500 }
    .powered { font-size: 0.68rem; color: #333; margin-top: 1rem }
    .powered span { color: var(--green) }
  </style>
</head>
<body>
  <div class="top">
    <h1>API Racer</h1>
    <p class="sub">Fans out to ${APIS.length} public APIs simultaneously from the tissue edge.
    Measures wall-clock latency from the cell — not from your browser.</p>
  </div>

  <button id="btn" onclick="race()">Race</button>

  <div class="board">
    <div id="rows">
      ${APIS.map(a => `
      <div class="api-row" id="row-${a.id}">
        <div class="dot dot-wait" id="dot-${a.id}"></div>
        <div class="api-label">${a.label}</div>
        <div class="api-data" id="data-${a.id}">—</div>
        <div class="api-ms" id="ms-${a.id}">—</div>
      </div>`).join('')}
    </div>
    <div class="summary" id="summary">
      <span class="stat-label">Total wall time</span>
      <span class="stat-val" id="s-total">—</span>
      <span class="stat-label">Sum of latencies</span>
      <span class="stat-val" id="s-sum">—</span>
      <span class="stat-label">Parallel speedup</span>
      <span class="stat-val" id="s-factor">—</span>
      <span class="stat-label">APIs called</span>
      <span class="stat-val" id="s-count">—</span>
    </div>
  </div>

  <p class="powered">Running on <span>tissue</span> · ${APIS.length} concurrent fetches · source at <a href="https://github.com/ki7dk/v8work/tree/main/examples/js-api-racer" style="color:#33ff77;text-decoration:none">github</a></p>

  <script>
    function msClass(ms) {
      if (ms < 200) return 'ms-fast';
      if (ms < 600) return 'ms-ok';
      return 'ms-slow';
    }

    function fmtData(r) {
      if (!r.ok) return r.error?.slice(0, 60) ?? 'error';
      const vals = Object.entries(r.data ?? {});
      return vals.map(([k, v]) => v !== undefined && v !== null ? String(v).slice(0, 50) : '').filter(Boolean).join(' · ') || 'ok';
    }

    async function race() {
      const btn = document.getElementById('btn');
      btn.disabled = true;
      btn.textContent = 'Racing…';

      // reset rows
      ${APIS.map(a => `
      document.getElementById('row-${a.id}').className = 'api-row';
      document.getElementById('dot-${a.id}').className = 'dot dot-wait';
      document.getElementById('data-${a.id}').textContent = '…';
      document.getElementById('ms-${a.id}').textContent = '…';
      `).join('')}
      document.getElementById('summary').className = 'summary';

      try {
        const res = await fetch('/race/json');
        const { results, total_ms, sum_ms, parallelism_factor } = await res.json();
        for (const r of results) {
          const row = document.getElementById('row-' + r.id);
          const dot = document.getElementById('dot-' + r.id);
          const data = document.getElementById('data-' + r.id);
          const ms = document.getElementById('ms-' + r.id);
          row.className = 'api-row ' + (r.ok ? 'done' : 'error');
          dot.className = 'dot ' + (r.ok ? 'dot-ok' : 'dot-err');
          data.textContent = fmtData(r);
          ms.textContent = r.ms + 'ms';
          ms.className = 'api-ms ' + msClass(r.ms);
        }
        const s = document.getElementById('summary');
        s.className = 'summary show';
        document.getElementById('s-total').textContent = total_ms + 'ms';
        document.getElementById('s-sum').textContent = sum_ms + 'ms';
        document.getElementById('s-factor').textContent = parallelism_factor + '×';
        document.getElementById('s-count').textContent = results.length;
      } catch(e) {
        console.error(e);
      }

      btn.disabled = false;
      btn.textContent = 'Race again';
    }
  </script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/race/json") {
      const data = await runRace();
      return Response.json(data);
    }

    return new Response(HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
