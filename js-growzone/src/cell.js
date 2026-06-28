/**
 * js-growzone — USDA Plant Hardiness Zone lookup by US zip code.
 *
 * Data: USDA-ARS / Oregon State University PRISM Climate Group (2023)
 * Source: https://prism.oregonstate.edu/phzm/data/2023/phzm_us_zipcode_2023.csv
 *
 * Routes:
 *   GET  /                    → HTML UI with zip code input
 *   GET  /api/growzone/:zip   → JSON zone data for a 5-digit zip
 */

import { getZoneByZip, getZoneDetails, getStateInfo, getExtensionService } from './data.js';
import { buildResponse, ZONE_COLORS } from './logic.js';

function zoneColor(n) { return ZONE_COLORS[n] ?? "#999"; }

async function lookupZip(zip) {
  const zoneData = await getZoneByZip(zip);
  if (!zoneData) return null;
  const zoneDetails = getZoneDetails(zoneData.zone.toLowerCase());
  return buildResponse(zip, zoneData, zoneDetails, getStateInfo, getExtensionService);
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>USDA Grow Zone Lookup</title>
<style>
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a;
    --accent: #4caf50; --accent-dim: #388e3c;
    --text: #e2e4ed; --muted: #6b7280;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; padding: 48px 16px;
  }
  header { text-align: center; margin-bottom: 36px; }
  .badge {
    display: inline-block; background: #1b3a1f; color: #81c784;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 3px 8px; border-radius: 4px; margin-bottom: 12px;
  }
  h1 { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 8px; }
  header p { color: var(--muted); font-size: 0.9rem; max-width: 420px; margin: 0 auto; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 28px; width: 100%; max-width: 520px;
  }
  .input-row { display: flex; gap: 10px; margin-bottom: 20px; }
  input[type="text"] {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 1.1rem;
    padding: 10px 14px; outline: none; letter-spacing: 0.1em;
    transition: border-color 0.15s;
  }
  input[type="text"]:focus { border-color: var(--accent); }
  button {
    background: var(--accent); border: none; border-radius: 8px; color: #fff;
    cursor: pointer; font-size: 0.9rem; font-weight: 600;
    padding: 10px 20px; transition: background 0.15s;
  }
  button:hover { background: var(--accent-dim); }
  button:disabled { opacity: 0.5; cursor: default; }
  #result { display: none; }
  .zone-badge {
    display: flex; align-items: center; gap: 16px;
    background: var(--bg); border-radius: 10px; padding: 16px 20px;
    margin-bottom: 20px;
  }
  .zone-dot {
    width: 52px; height: 52px; border-radius: 50%;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; font-weight: 800; color: #000;
  }
  .zone-name { font-size: 1.5rem; font-weight: 700; }
  .zone-loc { color: var(--muted); font-size: 0.85rem; margin-top: 3px; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
  }
  .stat {
    background: var(--bg); border-radius: 8px; padding: 12px 14px;
  }
  .stat-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .stat-value { font-size: 0.95rem; font-weight: 500; }
  .links { display: flex; gap: 10px; flex-wrap: wrap; }
  .link-btn {
    background: transparent; border: 1px solid var(--border);
    border-radius: 6px; color: var(--muted); font-size: 0.8rem;
    padding: 6px 12px; cursor: pointer; text-decoration: none;
    transition: border-color 0.15s, color 0.15s;
  }
  .link-btn:hover { border-color: var(--accent); color: var(--accent); }
  #error { color: #f87171; font-size: 0.9rem; display: none; padding: 10px 0; }
  #status { color: var(--muted); font-size: 0.85rem; min-height: 1.2em; margin-bottom: 8px; }
  .examples { margin-top: 20px; }
  .examples p { font-size: 0.8rem; color: var(--muted); margin-bottom: 8px; }
  .example-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 20px; padding: 4px 12px; font-size: 0.8rem;
    cursor: pointer; color: var(--muted); transition: all 0.15s;
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
  .source { margin-top: 28px; color: var(--muted); font-size: 0.75rem; text-align: center; }
  .source a { color: #4caf50; text-decoration: none; }
</style>
</head>
<body>
<header>
  <div class="badge">USDA 2023 Data</div>
  <h1>Grow Zone Lookup</h1>
  <p>Enter a US zip code to find your USDA Plant Hardiness Zone — the standard guide for what plants survive your winters.</p>
</header>
<div class="card">
  <div class="input-row">
    <input type="text" id="zip" placeholder="Enter zip code" maxlength="5" inputmode="numeric" pattern="[0-9]{5}">
    <button id="btn" onclick="lookup()">Look up</button>
  </div>
  <div id="status"></div>
  <div id="error"></div>
  <div id="result">
    <div class="zone-badge">
      <div class="zone-dot" id="zone-dot"></div>
      <div>
        <div class="zone-name" id="zone-name"></div>
        <div class="zone-loc" id="zone-loc"></div>
      </div>
    </div>
    <div class="grid">
      <div class="stat"><div class="stat-label">Temperature range</div><div class="stat-value" id="stat-temp"></div></div>
      <div class="stat"><div class="stat-label">Celsius range</div><div class="stat-value" id="stat-tempc"></div></div>
      <div class="stat"><div class="stat-label">Growing season</div><div class="stat-value" id="stat-season"></div></div>
      <div class="stat"><div class="stat-label">Last / first frost</div><div class="stat-value" id="stat-frost"></div></div>
    </div>
    <div class="links" id="links"></div>
  </div>
  <div class="examples">
    <p>Try a zip code:</p>
    <div class="example-chips">
      <span class="chip" onclick="setZip('98101')">98101 Seattle</span>
      <span class="chip" onclick="setZip('10001')">10001 New York</span>
      <span class="chip" onclick="setZip('33101')">33101 Miami</span>
      <span class="chip" onclick="setZip('80201')">80201 Denver</span>
      <span class="chip" onclick="setZip('99501')">99501 Anchorage</span>
      <span class="chip" onclick="setZip('96801')">96801 Honolulu</span>
    </div>
  </div>
</div>
<p class="source">
  Data: <a href="https://planthardiness.ars.usda.gov/" target="_blank">USDA Plant Hardiness Zone Map 2023</a>
  · USDA-ARS / Oregon State University PRISM Climate Group
</p>
<script>
const ZONE_COLORS = {
  1:"#c8e6ff",2:"#a0cfff",3:"#78b8ff",4:"#50a0ff",
  5:"#4caf50",6:"#8bc34a",7:"#cddc39",8:"#ffeb3b",
  9:"#ffc107",10:"#ff9800",11:"#ff5722",12:"#e53935",13:"#b71c1c"
};
function zoneColor(n) { return ZONE_COLORS[n] ?? "#999"; }

function setZip(z) {
  document.getElementById('zip').value = z;
  lookup();
}

document.getElementById('zip').addEventListener('keydown', e => {
  if (e.key === 'Enter') lookup();
});

async function lookup() {
  const zip = document.getElementById('zip').value.trim();
  if (!/^[0-9]{5}$/.test(zip)) {
    showError('Please enter a 5-digit US zip code.');
    return;
  }
  const btn = document.getElementById('btn');
  btn.disabled = true;
  document.getElementById('status').textContent = 'Looking up…';
  document.getElementById('error').style.display = 'none';
  document.getElementById('result').style.display = 'none';

  try {
    const res = await fetch('/api/growzone/' + zip);
    const data = await res.json();
    if (!res.ok) { showError(data.error ?? 'Not found'); return; }
    render(data);
  } catch(e) {
    showError('Network error: ' + e.message);
  } finally {
    btn.disabled = false;
    document.getElementById('status').textContent = '';
  }
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('result').style.display = 'none';
  document.getElementById('status').textContent = '';
}

function render(d) {
  const zn = d.zone.number;
  const color = zoneColor(zn);

  const dot = document.getElementById('zone-dot');
  dot.style.background = color;
  dot.textContent = d.zone.full;

  document.getElementById('zone-name').textContent = d.zone.name;
  const loc = d.location;
  document.getElementById('zone-loc').textContent =
    [loc.city, loc.stateFull].filter(Boolean).join(', ') +
    (loc.approximate ? ' (estimated)' : '');

  document.getElementById('stat-temp').textContent = d.temperature.rangeF ?? '—';
  document.getElementById('stat-tempc').textContent = d.temperature.rangeC ?? '—';
  document.getElementById('stat-season').textContent = d.growing?.season ?? '—';
  document.getElementById('stat-frost').textContent =
    d.growing?.lastFrost && d.growing?.firstFrost
      ? (d.growing.lastFrost + ' / ' + d.growing.firstFrost)
      : (d.growing?.season ?? '—');

  const links = document.getElementById('links');
  links.innerHTML = '';
  if (d.resources.usdaMap) {
    links.innerHTML += \`<a class="link-btn" href="\${d.resources.usdaMap}" target="_blank">USDA Map</a>\`;
  }
  if (d.resources.extensionService) {
    links.innerHTML += \`<a class="link-btn" href="\${d.resources.extensionService}" target="_blank">Extension Service</a>\`;
  }

  document.getElementById('result').style.display = 'block';
}
</script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    const m = path.match(/^\/api\/growzone\/(\d{5})$/);
    if (m) {
      const data = await lookupZip(m[1]);
      if (!data) {
        return Response.json({ error: `Zip code not found: ${m[1]}` }, { status: 404 });
      }
      return Response.json(data);
    }

    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
