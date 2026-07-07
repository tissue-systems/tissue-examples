/**
 * sense-coldchain — cold-chain compliance monitor
 *
 * Tracks temperature for refrigerated assets (walk-in fridges, freezers, cold rooms,
 * refrigerated trucks). Detects excursions (time outside safe [min_c, max_c] range),
 * maintains an auditable excursion log, computes time-in-range %, and exports CSV.
 *
 * Two ingest paths (both funnel into recordReading):
 *   - MQTT → synapse → sensor(event, env)      topic-based metric, JSON or bare value
 *   - HTTP → POST /readings (x-device-key)      body carries metric field
 *
 * Routes:
 *   GET  /                           — overview: one card per asset, sparkline, status
 *   POST /assets                     — register/update asset { device, name, min_c, max_c }
 *   GET  /assets                     — JSON list of all assets
 *   POST /devices                    — register HTTP device → { id, name, api_key }
 *   GET  /devices                    — JSON list of HTTP devices
 *   POST /readings                   — ingest reading (x-device-key header)
 *   GET  /asset/:device              — detail: chart, compliance windows, excursion log
 *   GET  /export.csv                 — ?device=&from=&to=&what=readings|excursions
 *   GET  /api/compliance             — ?device=&window=24h|7d → JSON
 *
 * Pulse: fires hourly, prunes raw readings older than 30 days.
 *
 * Deploy:
 *   ribo db create sense-coldchain
 *   ribo deploy
 */

// ─── SQL schemas ─────────────────────────────────────────────────────────────

// HTTP device registry: stores api_key for x-device-key authentication.
// (Synapse-sourced devices don't need this table; their id comes from event.device.)
const SCHEMA_DEVICES = `
  CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    api_key    TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// Asset configuration: maps a device id to a named monitored asset with a safe
// temperature range. Auto-populated with fridge defaults when an unknown device
// sends its first temperature reading (see getOrCreateAsset).
const SCHEMA_ASSETS = `
  CREATE TABLE IF NOT EXISTS assets (
    device     TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    min_c      REAL NOT NULL,
    max_c      REAL NOT NULL,
    created_at TEXT NOT NULL
  )
`;

// Canonical SENSE.md readings schema.
const SCHEMA_READINGS = `
  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device      TEXT NOT NULL,
    metric      TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    recorded_at TEXT NOT NULL
  )
`;

const SCHEMA_READINGS_IDX = `
  CREATE INDEX IF NOT EXISTS idx_readings_dev_metric_t
    ON readings(device, metric, recorded_at)
`;

// Excursion log: one row per contiguous out-of-range episode.
// An open excursion has ended_at = NULL. peak_c = warmest point seen;
// min_c_seen = coldest point seen. For a 'high' excursion peak_c is the
// primary audit value; for a 'low' excursion min_c_seen is.
const SCHEMA_EXCURSIONS = `
  CREATE TABLE IF NOT EXISTS excursions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    peak_c      REAL NOT NULL,
    min_c_seen  REAL NOT NULL,
    duration_s  REAL NOT NULL DEFAULT 0,
    n_readings  INTEGER NOT NULL DEFAULT 1
  )
`;

const SCHEMA_EXCURSIONS_IDX = `
  CREATE INDEX IF NOT EXISTS idx_excursions_device
    ON excursions(device, started_at)
`;

async function ensureSchema(DB) {
  await DB.exec(SCHEMA_DEVICES);
  await DB.exec(SCHEMA_ASSETS);
  await DB.exec(SCHEMA_READINGS);
  await DB.exec(SCHEMA_READINGS_IDX);
  await DB.exec(SCHEMA_EXCURSIONS);
  await DB.exec(SCHEMA_EXCURSIONS_IDX);
}

// ─── parseReading — SENSE.md canonical contract ──────────────────────────────

/**
 * parseReading — extract { device, metric, value, unit, recorded_at } from a
 * synapse sensor event. Metric comes from the trailing topic segment(s).
 * Handles JSON payloads { value, unit, ts } and bare numeric strings.
 */
function parseReading(event) {
  // topic: tissue/<account>/<device>/<metric...>
  const metric = event.topic.split("/").slice(3).join("/") || "value";
  let value = null, unit = null, ts = null;
  try {
    const b = event.json(); // { value, unit, ts }
    value = Number(b.value);
    unit  = b.unit ?? null;
    ts    = b.ts   ?? null;
  } catch {
    const n = Number(event.text()); // bare numeric string
    value = Number.isNaN(n) ? null : n;
  }
  return {
    device: event.device,
    metric,
    value: Number.isNaN(value) ? null : value,
    unit,
    recorded_at: ts || event.receivedTime || new Date().toISOString(),
  };
}

// ─── Asset auto-creation ──────────────────────────────────────────────────────

/**
 * getOrCreateAsset — return the asset config for a device. If none exists, create
 * one with sensible fridge defaults (0–8 °C) so the Cell works without prior setup.
 * The operator can correct the name / range with POST /assets at any time.
 */
async function getOrCreateAsset(DB, device, now) {
  const row = await DB.prepare(
    "SELECT device, name, min_c, max_c FROM assets WHERE device = ?"
  ).bind(device).first();
  if (row) return row;

  await DB.prepare(
    "INSERT OR IGNORE INTO assets (device, name, min_c, max_c, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(device, device, 0.0, 8.0, now).run();

  return { device, name: device, min_c: 0.0, max_c: 8.0 };
}

// ─── Excursion tracking ───────────────────────────────────────────────────────

/**
 * updateExcursion — maintain the excursions table on every temperature reading.
 *
 * Cells are stateless between requests. We derive current excursion state entirely
 * from the DB by querying for an open row (ended_at IS NULL). No in-memory tracking.
 *
 * State machine:
 *   in range  + no open → nothing to do
 *   out of range + no open  → INSERT new excursion (open)
 *   out of range + open     → UPDATE peak/min/duration/n_readings
 *   in range  + open        → UPDATE ended_at + final duration (close)
 *
 * Edge case: if the asset's safe range was edited between readings, the open
 * excursion's kind may no longer match the current violation direction. We detect
 * this and close the stale excursion before opening a fresh one.
 */
async function updateExcursion(DB, device, value, asset, now) {
  const { min_c, max_c } = asset;
  const outOfRange = value < min_c || value > max_c;
  const kind = value > max_c ? "high" : "low";
  const nowMs = new Date(now).getTime();

  // Look for any open excursion for this device (at most one should exist)
  let open = await DB.prepare(
    "SELECT id, kind, started_at, peak_c, min_c_seen, n_readings " +
    "FROM excursions WHERE device = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
  ).bind(device).first();

  // Close a stale open excursion whose direction no longer matches
  if (open && outOfRange && open.kind !== kind) {
    const dur = (nowMs - new Date(open.started_at).getTime()) / 1000;
    await DB.prepare(
      "UPDATE excursions SET ended_at = ?, duration_s = ? WHERE id = ?"
    ).bind(now, dur, open.id).run();
    open = null;
  }

  if (outOfRange) {
    if (!open) {
      // Open a new excursion
      await DB.prepare(
        "INSERT INTO excursions (device, kind, started_at, peak_c, min_c_seen, duration_s, n_readings) " +
        "VALUES (?, ?, ?, ?, ?, 0, 1)"
      ).bind(device, kind, now, value, value).run();
    } else {
      // Update the running excursion
      const dur      = (nowMs - new Date(open.started_at).getTime()) / 1000;
      const newPeak  = Math.max(open.peak_c,     value); // warmest point (relevant for 'high')
      const newMin   = Math.min(open.min_c_seen, value); // coldest point (relevant for 'low')
      await DB.prepare(
        "UPDATE excursions SET peak_c = ?, min_c_seen = ?, duration_s = ?, n_readings = ? WHERE id = ?"
      ).bind(newPeak, newMin, dur, open.n_readings + 1, open.id).run();
    }
  } else if (open) {
    // Returned to safe range — close the excursion
    const dur = (nowMs - new Date(open.started_at).getTime()) / 1000;
    await DB.prepare(
      "UPDATE excursions SET ended_at = ?, duration_s = ? WHERE id = ?"
    ).bind(now, dur, open.id).run();
  }
}

// ─── Shared ingest path ───────────────────────────────────────────────────────

/**
 * recordReading — converges both sensor() and POST /readings onto one path.
 * Stores the reading and, for temperature metrics, drives excursion tracking.
 */
async function recordReading(DB, { device, metric, value, unit, recorded_at }) {
  const now = recorded_at ?? new Date().toISOString();

  // Auto-register the device so /api/devices + dashboards discover MQTT-ingested
  // devices (the HTTP path registers via POST /devices; synapse ones do not).
  await DB.prepare(
    "INSERT OR IGNORE INTO devices (id, name, api_key, created_at) VALUES (?, ?, ?, ?)"
  ).bind(device, device, "mqtt:" + device, recorded_at).run();
  await DB.prepare(
    "INSERT INTO readings (device, metric, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(device, metric, value ?? null, unit ?? null, now).run();

  // Only run cold-chain logic for temperature readings with a numeric value
  if (metric !== "temperature" || value == null || Number.isNaN(value)) return;

  const asset = await getOrCreateAsset(DB, device, now);
  await updateExcursion(DB, device, value, asset, now);
}

// ─── Compliance calculation ───────────────────────────────────────────────────

/**
 * timeInRange — fraction of temperature readings within [min_c, max_c] over a window.
 *
 * Method: sample-based. We count temperature readings whose value falls within the
 * safe range, divided by total temperature readings in the window. This is an
 * approximation: it assumes readings are roughly evenly spaced in time. If sampling
 * is irregular (bursty transmissions or gaps), a time-weighted approach using
 * excursion duration vs. window length would be more accurate for audit purposes.
 * For the purpose of this example, sample-based is simple, transparent, and correct
 * when sensor-test sends at a regular interval.
 */
async function timeInRange(DB, device, fromTs, toTs) {
  const asset = await DB.prepare(
    "SELECT min_c, max_c FROM assets WHERE device = ?"
  ).bind(device).first();
  if (!asset) return null;

  const totalRow = await DB.prepare(
    "SELECT COUNT(*) AS n FROM readings " +
    "WHERE device = ? AND metric = 'temperature' AND recorded_at >= ? AND recorded_at <= ?"
  ).bind(device, fromTs, toTs).first();
  const total = totalRow?.n ?? 0;
  if (total === 0) return null;

  const inRangeRow = await DB.prepare(
    "SELECT COUNT(*) AS n FROM readings " +
    "WHERE device = ? AND metric = 'temperature' " +
    "AND recorded_at >= ? AND recorded_at <= ? AND value >= ? AND value <= ?"
  ).bind(device, fromTs, toTs, asset.min_c, asset.max_c).first();
  const inRange = inRangeRow?.n ?? 0;

  return { pct: (inRange / total) * 100, inRange, total };
}

// ─── SVG sparkline with safe-band guide lines ────────────────────────────────

/**
 * sparkline — server-rendered SVG line chart.
 * points: [{ t: <ms epoch>, v: <number> }] sorted ascending by t.
 *
 * opts.minSafe / opts.maxSafe: draws dashed horizontal guide lines and a light
 * green safe-band rect. The viewport always expands to show both lines in full,
 * so points outside the band visually sit above or below the coloured region.
 */
function sparkline(points, opts = {}) {
  const W = opts.width ?? 320, H = opts.height ?? 64, pad = opts.pad ?? 6;
  const stroke = opts.stroke ?? "#2563eb";
  const fill   = opts.fill   ?? "rgba(37,99,235,.12)";

  if (!points.length) {
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="no data">
      <text x="${W/2}" y="${H/2}" text-anchor="middle" dominant-baseline="middle"
            font-family="system-ui" font-size="11" fill="#9ca3af">no data</text></svg>`;
  }

  const ts = points.map(p => p.t);
  const vs = points.map(p => p.v);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);

  // Expand value range to ensure safe-band lines are always visible
  const allV = [...vs];
  if (opts.minSafe != null) allV.push(opts.minSafe);
  if (opts.maxSafe != null) allV.push(opts.maxSafe);
  const v0 = opts.min ?? Math.min(...allV);
  const v1 = opts.max ?? Math.max(...allV);

  const sx = t => t1 === t0 ? pad : pad + (t - t0) / (t1 - t0) * (W - 2 * pad);
  const sy = v => v1 === v0 ? H / 2  : H - pad - (v - v0) / (v1 - v0) * (H - 2 * pad);

  const line = points.map((p, i) =>
    `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`
  ).join("");
  const area =
    `M${sx(t0).toFixed(1)},${(H - pad).toFixed(1)}` +
    points.map(p => `L${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join("") +
    `L${sx(t1).toFixed(1)},${(H - pad).toFixed(1)}Z`;

  // Safe-band: light green fill between min and max safe
  let bandFill = "";
  if (opts.minSafe != null && opts.maxSafe != null) {
    const yTop = sy(opts.maxSafe).toFixed(1);
    const yBot = sy(opts.minSafe).toFixed(1);
    const bh   = (parseFloat(yBot) - parseFloat(yTop)).toFixed(1);
    bandFill = `<rect x="${pad}" y="${yTop}" width="${W - 2 * pad}" height="${bh}" fill="rgba(34,197,94,.13)" stroke="none"/>`;
  }

  // Dashed guide lines at safe boundaries
  let guideLines = "";
  if (opts.maxSafe != null) {
    const y = sy(opts.maxSafe).toFixed(1);
    guideLines += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#ef4444" stroke-width="1" stroke-dasharray="3 2" opacity="0.75"/>`;
  }
  if (opts.minSafe != null) {
    const y = sy(opts.minSafe).toFixed(1);
    guideLines += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#3b82f6" stroke-width="1" stroke-dasharray="3 2" opacity="0.75"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" role="img">
    ${bandFill}
    <path d="${area}" fill="${fill}" stroke="none"/>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${guideLines}
  </svg>`;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonError(msg, status) {
  return Response.json({ error: msg }, { status });
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 4180: quote any field that contains comma, double-quote, or newline. */
function csvField(v) {
  const s = String(v ?? "");
  if (/[,"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(fields) {
  return fields.map(csvField).join(",") + "\r\n";
}

function fmtDuration(seconds) {
  if (seconds == null || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function windowBounds(win) {
  const now = Date.now();
  const ms  = win === "7d" ? 7 * 24 * 3600_000 : 24 * 3600_000;
  return { from: new Date(now - ms).toISOString(), to: new Date(now).toISOString() };
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f1f5f9; color: #1e293b; padding: 1.5rem 1rem }
  .wrap { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem }
  .hdr  { background: #fff; border-radius: 12px; padding: 1.25rem 1.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap }
  .hdr h1 { font-size: 1.35rem; font-weight: 700; letter-spacing: -.01em }
  .hdr .sub { font-size: .82rem; color: #94a3b8 }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1rem }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
          padding: 1.25rem; display: flex; flex-direction: column; gap: .8rem }
  .card-hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: .5rem }
  .card-title { font-size: 1rem; font-weight: 600 }
  .card-dev   { font-size: .73rem; color: #94a3b8; font-family: ui-monospace, monospace; margin-top: .1rem }
  .badge { display: inline-block; padding: .2em .7em; border-radius: 999px;
           font-size: .73rem; font-weight: 600; white-space: nowrap; letter-spacing: .02em }
  .badge-ok   { background: #dcfce7; color: #15803d }
  .badge-warn { background: #fee2e2; color: #b91c1c }
  .exc-dur { font-size: .72rem; color: #b91c1c; margin-top: .2rem; text-align: right }
  .meta { font-size: .8rem; color: #64748b; display: flex; flex-direction: column; gap: .22rem }
  .meta strong { color: #334155 }
  .compliance { display: flex; gap: .75rem }
  .comp-item  { flex: 1; background: #f8fafc; border-radius: 8px; padding: .5rem .5rem; text-align: center }
  .comp-pct   { font-size: 1.05rem; font-weight: 700; color: #1e293b }
  .comp-lbl   { font-size: .68rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; margin-top: .1rem }
  .chart-wrap { border-radius: 6px; overflow: hidden; background: #f8fafc }
  .chart-wrap svg { display: block; width: 100%; height: auto }
  .section { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); padding: 1.5rem }
  .section h2 { font-size: .92rem; font-weight: 600; margin-bottom: 1rem; color: #475569;
                text-transform: uppercase; letter-spacing: .05em }
  table { width: 100%; border-collapse: collapse; font-size: .875rem }
  th { text-align: left; padding: .5rem .75rem; border-bottom: 2px solid #f1f5f9;
       font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8 }
  td { padding: .55rem .75rem; border-bottom: 1px solid #f8fafc; vertical-align: top }
  tr:last-child td { border-bottom: none }
  .mono { font-family: ui-monospace, monospace; font-size: .82rem }
  .num  { text-align: right; font-variant-numeric: tabular-nums }
  .ts   { color: #94a3b8; font-size: .78rem; white-space: nowrap }
  .empty { color: #94a3b8; text-align: center; padding: 1.5rem; font-size: .88rem; font-style: italic }
  a { color: #2563eb; text-decoration: none }
  a:hover { text-decoration: underline }
  .exc-hi { color: #b91c1c; font-weight: 600 }
  .exc-lo { color: #1d4ed8; font-weight: 600 }
  .open-tag { font-size: .7rem; background: #fee2e2; color: #b91c1c;
              padding: .15em .45em; border-radius: 4px; margin-left: .35em; font-weight: 600 }
  .chart-legend { font-size: .72rem; color: #94a3b8; margin-top: .4rem }
  .leg-red  { color: #ef4444 }
  .leg-blue { color: #3b82f6 }
  .leg-green { color: #22c55e }
`;

// ─── Overview page ────────────────────────────────────────────────────────────

async function renderOverview(DB) {
  const { results: assets } = await DB.prepare(
    "SELECT device, name, min_c, max_c FROM assets ORDER BY name"
  ).all();

  if (!assets.length) {
    return page("Cold-Chain Monitor", `
      <div class="hdr"><h1>❄ Cold-Chain Monitor</h1><span class="sub">No assets yet</span></div>
      <div class="section">
        <p class="empty">No assets registered. POST to /assets or send temperature readings to get started.</p>
      </div>`);
  }

  const nowTs  = new Date().toISOString();
  const ago24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const ago7d  = new Date(Date.now() -  7 * 24 * 3600_000).toISOString();

  const cards = [];
  for (const asset of assets) {
    // Open excursion check (stateless: query DB for ended_at IS NULL)
    const openExc = await DB.prepare(
      "SELECT kind, started_at FROM excursions WHERE device = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    ).bind(asset.device).first();

    // Total excursion count
    const excRow = await DB.prepare(
      "SELECT COUNT(*) AS n FROM excursions WHERE device = ?"
    ).bind(asset.device).first();

    // Most recent temperature reading
    const lastRow = await DB.prepare(
      "SELECT value, recorded_at FROM readings WHERE device = ? AND metric = 'temperature' ORDER BY id DESC LIMIT 1"
    ).bind(asset.device).first();

    // Compliance percentages
    const c24 = await timeInRange(DB, asset.device, ago24h, nowTs);
    const c7d  = await timeInRange(DB, asset.device, ago7d,  nowTs);

    // Sparkline: last 100 temperature readings, newest first → reverse for ascending time
    const { results: pts } = await DB.prepare(
      "SELECT value, recorded_at FROM readings WHERE device = ? AND metric = 'temperature' ORDER BY id DESC LIMIT 100"
    ).bind(asset.device).all();
    const sparkPts = pts.reverse().map(r => ({
      t: new Date(r.recorded_at).getTime(),
      v: r.value,
    }));
    const svg = sparkline(sparkPts, {
      width: 280, height: 56,
      minSafe: asset.min_c, maxSafe: asset.max_c,
    });

    // Status badge
    let badge, excDur = "";
    if (openExc) {
      const dur = (Date.now() - new Date(openExc.started_at).getTime()) / 1000;
      badge   = `<span class="badge badge-warn">EXCURSION ${esc(openExc.kind.toUpperCase())}</span>`;
      excDur  = `<div class="exc-dur">for ${esc(fmtDuration(dur))}</div>`;
    } else {
      badge = `<span class="badge badge-ok">IN RANGE</span>`;
    }

    const lastStr = lastRow
      ? `${lastRow.value.toFixed(1)} °C · ${fmtDuration((Date.now() - new Date(lastRow.recorded_at).getTime()) / 1000)} ago`
      : "no readings yet";

    const fmtPct = r => r ? `${r.pct.toFixed(1)}%` : "—";

    cards.push(`
<div class="card">
  <div class="card-hdr">
    <div>
      <div class="card-title"><a href="/asset/${esc(asset.device)}">${esc(asset.name)}</a></div>
      <div class="card-dev">${esc(asset.device)}</div>
    </div>
    <div style="text-align:right">${badge}${excDur}</div>
  </div>
  <div class="chart-wrap">${svg}</div>
  <div class="meta">
    <div><strong>Safe range:</strong> ${esc(asset.min_c)} – ${esc(asset.max_c)} °C</div>
    <div><strong>Last reading:</strong> ${esc(lastStr)}</div>
    <div><strong>Total excursions:</strong> ${esc(excRow?.n ?? 0)}</div>
  </div>
  <div class="compliance">
    <div class="comp-item">
      <div class="comp-pct">${esc(fmtPct(c24))}</div>
      <div class="comp-lbl">24 h in range</div>
    </div>
    <div class="comp-item">
      <div class="comp-pct">${esc(fmtPct(c7d))}</div>
      <div class="comp-lbl">7 d in range</div>
    </div>
  </div>
</div>`);
  }

  return page("Cold-Chain Monitor", `
    <div class="hdr">
      <h1>❄ Cold-Chain Monitor</h1>
      <span class="sub">${assets.length} asset${assets.length === 1 ? "" : "s"} · auto-refreshes every 30 s</span>
    </div>
    <div class="grid">${cards.join("")}</div>`);
}

// ─── Asset detail page ────────────────────────────────────────────────────────

async function renderAssetDetail(DB, device) {
  const asset = await DB.prepare(
    "SELECT device, name, min_c, max_c FROM assets WHERE device = ?"
  ).bind(device).first();
  if (!asset) return null;

  // Wider sparkline for detail view (last 200 readings)
  const { results: pts } = await DB.prepare(
    "SELECT value, recorded_at FROM readings WHERE device = ? AND metric = 'temperature' ORDER BY id DESC LIMIT 200"
  ).bind(device).all();
  const sparkPts = pts.reverse().map(r => ({
    t: new Date(r.recorded_at).getTime(),
    v: r.value,
  }));
  const svg = sparkline(sparkPts, {
    width: 640, height: 120,
    minSafe: asset.min_c, maxSafe: asset.max_c,
  });

  // Compliance for three windows
  const nowTs = new Date().toISOString();
  const compData = [
    { label: "Last 24 hours", from: new Date(Date.now() -       24 * 3600_000).toISOString() },
    { label: "Last 7 days",   from: new Date(Date.now() -   7 * 24 * 3600_000).toISOString() },
    { label: "Last 30 days",  from: new Date(Date.now() -  30 * 24 * 3600_000).toISOString() },
  ];
  let compRows = "";
  for (const w of compData) {
    const r = await timeInRange(DB, device, w.from, nowTs);
    compRows += `<tr>
      <td>${esc(w.label)}</td>
      <td class="num">${r ? esc(r.pct.toFixed(2)) + "%" : "—"}</td>
      <td class="num">${r ? r.inRange : "—"}</td>
      <td class="num">${r ? r.total : "—"}</td>
    </tr>`;
  }

  // Excursion log (last 50, newest first)
  const { results: excursions } = await DB.prepare(
    "SELECT id, kind, started_at, ended_at, peak_c, min_c_seen, duration_s, n_readings " +
    "FROM excursions WHERE device = ? ORDER BY id DESC LIMIT 50"
  ).bind(device).all();

  let excRows = "";
  if (excursions.length) {
    for (const e of excursions) {
      const isOpen   = e.ended_at === null;
      const kindHtml = e.kind === "high"
        ? `<span class="exc-hi">▲ HIGH</span>`
        : `<span class="exc-lo">▼ LOW</span>`;
      // For 'high' excursions, peak_c (warmest) is the headline; for 'low', min_c_seen (coldest).
      const worstVal = e.kind === "high"
        ? `${e.peak_c.toFixed(1)} °C`
        : `${e.min_c_seen.toFixed(1)} °C`;
      const durStr = isOpen
        ? `${fmtDuration((Date.now() - new Date(e.started_at).getTime()) / 1000)}<span class="open-tag">OPEN</span>`
        : esc(fmtDuration(e.duration_s));
      const endedStr = isOpen ? "<em>ongoing</em>" : esc(e.ended_at.slice(0, 16).replace("T", " "));

      excRows += `<tr>
        <td>${kindHtml}</td>
        <td class="ts">${esc(e.started_at.slice(0, 16).replace("T", " "))}</td>
        <td class="ts">${endedStr}</td>
        <td>${durStr}</td>
        <td class="num">${esc(worstVal)}</td>
        <td class="num">${e.n_readings}</td>
      </tr>`;
    }
  } else {
    excRows = `<tr><td colspan="6" class="empty">No excursions recorded — asset has stayed in range</td></tr>`;
  }

  // Current status
  const openExc = await DB.prepare(
    "SELECT kind, started_at FROM excursions WHERE device = ? AND ended_at IS NULL LIMIT 1"
  ).bind(device).first();
  const statusBadge = openExc
    ? `<span class="badge badge-warn">EXCURSION ${esc(openExc.kind.toUpperCase())} · ${esc(fmtDuration((Date.now() - new Date(openExc.started_at).getTime()) / 1000))}</span>`
    : `<span class="badge badge-ok">IN RANGE</span>`;

  return page(`${esc(asset.name)} — Cold-Chain Monitor`, `
    <div class="hdr">
      <div>
        <div style="font-size:.82rem;color:#94a3b8;margin-bottom:.3rem"><a href="/">← All assets</a></div>
        <h1>${esc(asset.name)}</h1>
        <div class="sub" style="margin-top:.3rem">
          ${esc(asset.device)} &nbsp;·&nbsp; safe ${esc(asset.min_c)}–${esc(asset.max_c)} °C
          &nbsp;·&nbsp; ${statusBadge}
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Temperature — last 200 readings</h2>
      <div class="chart-wrap">${svg}</div>
      <p class="chart-legend" style="margin-top:.5rem">
        <span class="leg-red">— — max safe (${esc(asset.max_c)} °C)</span>
        &nbsp;&nbsp;
        <span class="leg-blue">— — min safe (${esc(asset.min_c)} °C)</span>
        &nbsp;&nbsp;
        <span class="leg-green">■ safe zone</span>
      </p>
    </div>

    <div class="section">
      <h2>Compliance (sample-based)</h2>
      <table>
        <thead><tr><th>Window</th><th>In-range %</th><th>In-range readings</th><th>Total readings</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
      <p style="font-size:.75rem;color:#94a3b8;margin-top:.75rem">
        Method: readings in range ÷ total readings in window. Assumes roughly uniform sampling.
        See <code>/api/compliance?device=${esc(device)}&amp;window=24h</code> for JSON.
      </p>
    </div>

    <div class="section">
      <h2>Excursion log — last 50</h2>
      <table>
        <thead>
          <tr>
            <th>Kind</th><th>Started (UTC)</th><th>Ended (UTC)</th>
            <th>Duration</th><th>Worst reading</th><th>Readings</th>
          </tr>
        </thead>
        <tbody>${excRows}</tbody>
      </table>
      <p style="font-size:.78rem;color:#94a3b8;margin-top:.75rem">
        Export:
        <a href="/export.csv?device=${esc(device)}&amp;what=excursions">excursion log CSV</a>
        &nbsp;·&nbsp;
        <a href="/export.csv?device=${esc(device)}&amp;what=readings">readings CSV</a>
      </p>
    </div>`, true /* refresh */);
}

// ─── Page shell ───────────────────────────────────────────────────────────────

function page(title, body, autoRefresh = true) {
  const refresh = autoRefresh
    ? `<meta http-equiv="refresh" content="30">`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh}
  <title>${esc(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
</body>
</html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default {
  // ── sensor() — MQTT readings delivered by synapse ──────────────────────────
  async sensor(event, env) {
    await ensureSchema(env.DB);
    const reading = parseReading(event);
    if (reading.value == null) return; // skip non-numeric or unparseable payloads
    await recordReading(env.DB, reading);
  },

  // ── pulse() — hourly maintenance ───────────────────────────────────────────
  async pulse(event, env) {
    await ensureSchema(env.DB);
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM readings").first())?.n ?? 0;
    await env.DB.prepare("DELETE FROM readings WHERE recorded_at < ?").bind(cutoff).run();
    const after  = (await env.DB.prepare("SELECT COUNT(*) AS n FROM readings").first())?.n ?? 0;
    console.log(`pulse: pruned ${before - after} readings older than 30 days (${after} remaining)`);
  },

  // ── fetch() — HTTP handler ─────────────────────────────────────────────────
  async fetch(request, env) {
    await ensureSchema(env.DB);
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // POST /assets — register or update an asset with its safe temperature range
    if (method === "POST" && path === "/assets") {
      let body;
      try { body = await request.json(); }
      catch { return jsonError("invalid JSON body", 400); }

      const { device, name, min_c, max_c } = body ?? {};
      if (!device || !name)
        return jsonError("device and name are required", 400);
      if (min_c == null || max_c == null || isNaN(Number(min_c)) || isNaN(Number(max_c)))
        return jsonError("min_c and max_c are required numbers", 400);
      if (Number(min_c) >= Number(max_c))
        return jsonError("min_c must be less than max_c", 400);

      const now = new Date().toISOString();
      // Upsert: insert or update range/name if device already exists
      await env.DB.prepare(
        "INSERT INTO assets (device, name, min_c, max_c, created_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(device) DO UPDATE SET name = excluded.name, min_c = excluded.min_c, max_c = excluded.max_c"
      ).bind(String(device), String(name), Number(min_c), Number(max_c), now).run();

      return Response.json(
        { device: String(device), name: String(name), min_c: Number(min_c), max_c: Number(max_c) },
        { status: 201 }
      );
    }

    // GET /assets — list all registered assets
    if (method === "GET" && path === "/assets") {
      const { results } = await env.DB.prepare(
        "SELECT device, name, min_c, max_c, created_at FROM assets ORDER BY name"
      ).all();
      return Response.json(results);
    }

    // POST /devices — register an HTTP device, receive an api_key for POST /readings
    if (method === "POST" && path === "/devices") {
      let name;
      try { ({ name } = await request.json()); }
      catch { return jsonError("invalid JSON body", 400); }
      name = (name ?? "").toString().trim();
      if (!name) return jsonError("name is required", 400);

      const id      = "dev_" + randomHex(8);
      const api_key = "key_" + randomHex(32);
      const now     = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO devices (id, name, api_key, created_at) VALUES (?, ?, ?, ?)"
      ).bind(id, name, api_key, now).run();

      return Response.json({ id, name, api_key, created_at: now }, { status: 201 });
    }

    // GET /devices — list HTTP devices (api_key omitted)
    if (method === "GET" && path === "/devices") {
      const { results } = await env.DB.prepare(
        "SELECT id, name, created_at FROM devices ORDER BY created_at DESC"
      ).all();
      return Response.json(results);
    }

    // POST /readings — HTTP ingest (requires x-device-key header)
    if (method === "POST" && path === "/readings") {
      const apiKey = request.headers.get("x-device-key") ?? "";
      if (!apiKey) return jsonError("x-device-key header required", 401);

      const dev = await env.DB.prepare(
        "SELECT id FROM devices WHERE api_key = ?"
      ).bind(apiKey).first();
      if (!dev) return jsonError("invalid device key", 403);

      let metric, value, unit;
      try {
        const body = await request.json();
        metric = (body.metric ?? "").toString().trim();
        value  = Number(body.value);
        unit   = body.unit ? body.unit.toString().trim() : null;
      } catch { return jsonError("invalid JSON body", 400); }
      if (!metric)       return jsonError("metric is required", 400);
      if (isNaN(value))  return jsonError("value must be a number", 400);

      const now = new Date().toISOString();
      await recordReading(env.DB, { device: dev.id, metric, value, unit, recorded_at: now });
      return Response.json({ ok: true, device: dev.id, metric, value, recorded_at: now }, { status: 201 });
    }

    // GET /asset/:device — detail page
    const assetMatch = path.match(/^\/asset\/([^/]+)$/);
    if (method === "GET" && assetMatch) {
      const device = decodeURIComponent(assetMatch[1]);
      const html   = await renderAssetDetail(env.DB, device);
      if (!html) return new Response("asset not found", { status: 404 });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // GET /export.csv?device=&from=&to=&what=readings|excursions
    if (method === "GET" && path === "/export.csv") {
      const device = url.searchParams.get("device") ?? "";
      const what   = url.searchParams.get("what")   ?? "readings";
      const fromTs = url.searchParams.get("from")   ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
      const toTs   = url.searchParams.get("to")     ?? new Date().toISOString();

      if (!device) return jsonError("device parameter required", 400);
      if (!["readings", "excursions"].includes(what))
        return jsonError("what must be 'readings' or 'excursions'", 400);

      const filename = `coldchain-${what}-${device}-${fromTs.slice(0, 10)}.csv`;
      let csv = "";

      if (what === "readings") {
        const { results } = await env.DB.prepare(
          "SELECT id, device, metric, value, unit, recorded_at FROM readings " +
          "WHERE device = ? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at"
        ).bind(device, fromTs, toTs).all();
        csv += csvRow(["id", "device", "metric", "value", "unit", "recorded_at"]);
        for (const r of results) {
          csv += csvRow([r.id, r.device, r.metric, r.value ?? "", r.unit ?? "", r.recorded_at]);
        }
      } else {
        const { results } = await env.DB.prepare(
          "SELECT id, device, kind, started_at, ended_at, peak_c, min_c_seen, duration_s, n_readings " +
          "FROM excursions WHERE device = ? AND started_at >= ? AND started_at <= ? ORDER BY started_at"
        ).bind(device, fromTs, toTs).all();
        csv += csvRow(["id", "device", "kind", "started_at", "ended_at", "peak_c", "min_c_seen", "duration_s", "n_readings"]);
        for (const e of results) {
          csv += csvRow([e.id, e.device, e.kind, e.started_at, e.ended_at ?? "", e.peak_c, e.min_c_seen, e.duration_s, e.n_readings]);
        }
      }

      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // GET /api/compliance?device=&window=24h|7d
    if (method === "GET" && path === "/api/compliance") {
      const device    = url.searchParams.get("device") ?? "";
      const windowStr = url.searchParams.get("window") ?? "24h";
      if (!device) return jsonError("device parameter required", 400);
      if (!["24h", "7d"].includes(windowStr))
        return jsonError("window must be '24h' or '7d'", 400);

      const { from, to } = windowBounds(windowStr);
      const result = await timeInRange(env.DB, device, from, to);
      if (!result) return jsonError("no temperature data for this device in the requested window", 404);

      return Response.json({
        device,
        window: windowStr,
        from,
        to,
        total_readings:    result.total,
        in_range_readings: result.inRange,
        time_in_range_pct: parseFloat(result.pct.toFixed(2)),
        method: "sample-based",
        note: "Approximation: in-range readings / total readings. Assumes uniform sampling frequency; gaps or bursts reduce accuracy.",
      });
    }

    // GET / — overview dashboard
    if (method === "GET" && path === "/") {
      const html = await renderOverview(env.DB);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },
};
