#!/usr/bin/env node
// Runs every tour cell's /selftest, then the client-side checks: SSE, a
// WebSocket round trip, a streamed request body and the vesicle webhook route.
//
//   node smoke.mjs storage=<url> realtime=<url> data=<url>
//
// Each <url> is the cell's base URL: https://tour-storage.<sub>.tissue.dev on
// production, or http://localhost:18080/<address> through a tunnel to a
// staging edge. Any cell can be left out. Exits non-zero if a check fails.

const cells = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")).map(([k, v]) => [k, v.replace(/\/$/, "")]));
let failed = 0;

function report(cell, name, ok, detail) {
  if (!ok) failed += 1;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "pass" : "FAIL"}  ${cell.padEnd(9)} ${name}${d ? `  (${d.slice(0, 110)})` : ""}`);
}

async function step(cell, name, fn) {
  try {
    report(cell, name, true, await fn());
  } catch (err) {
    report(cell, name, false, String(err && err.message || err));
  }
}

async function selftest(cell, base) {
  let body;
  try {
    const res = await fetch(`${base}/selftest`);
    body = await res.json();
  } catch (err) {
    report(cell, "/selftest", false, String(err.message || err));
    return;
  }
  for (const c of body.checks) report(cell, c.name, c.ok, c.detail);
}

async function sse(base) {
  const res = await fetch(`${base}/sse`);
  if (res.headers.get("content-type") !== "text/event-stream") throw new Error(`content-type ${res.headers.get("content-type")}`);
  const started = Date.now();
  const text = await res.text();
  const ticks = text.match(/^event: tick$/gm)?.length ?? 0;
  if (ticks !== 5 || !text.includes("event: done")) throw new Error(`${ticks} ticks`);
  return `5 ticks over ${Date.now() - started} ms`;
}

function websocket(base) {
  const url = base.replace(/^http/, "ws") + "/ws";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const got = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout, got ${JSON.stringify(got)}`)); }, 10000);
    ws.addEventListener("message", (ev) => {
      got.push(JSON.parse(ev.data));
      if (got.length === 1) ws.send("ping-1");
      else if (got.length === 2) ws.send("close");
    });
    ws.addEventListener("close", (ev) => {
      clearTimeout(timer);
      if (got[0]?.hello && got[1]?.echo === "ping-1" && ev.code === 1000) resolve(`hello, echo, close ${ev.code}`);
      else reject(new Error(`close ${ev.code}, got ${JSON.stringify(got)}`));
    });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`error on ${url}`)); });
  });
}

async function echo(base) {
  const chunks = ["abc", "def", "ghi"];
  const body = new ReadableStream({
    async pull(ctl) {
      const c = chunks.shift();
      if (c === undefined) return ctl.close();
      await new Promise((r) => setTimeout(r, 100));
      ctl.enqueue(new TextEncoder().encode(c));
    },
  });
  const res = await fetch(`${base}/echo`, { method: "POST", body, duplex: "half" });
  const text = await res.text();
  if (text !== "ABCDEFGHI") throw new Error(text);
  return text;
}

async function hook(base) {
  const marker = `smoke-${Date.now()}`;
  const res = await fetch(`${base}/hook`, { method: "POST", body: JSON.stringify({ marker }), headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`POST /hook ${res.status}`);
  const list = await (await fetch(`${base}/hooks`)).json();
  if (!list.recent.some((h) => h.body.includes(marker))) throw new Error("posted hook not listed");
  return `stored, ${list.count} total`;
}

async function files(base) {
  const res = await fetch(`${base}/data.json`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const missing = await fetch(`${base}/no-such-file`);
  if (missing.status !== 404) throw new Error(`missing file answered ${missing.status}`);
  return "200 and 404";
}

if (cells.storage) {
  await selftest("storage", cells.storage);
  await step("storage", "files served over HTTP", () => files(cells.storage));
  await step("storage", "webhook route stores and lists", () => hook(cells.storage));
}
if (cells.realtime) {
  await selftest("realtime", cells.realtime);
  await step("realtime", "SSE stream", () => sse(cells.realtime));
  await step("realtime", "WebSocket round trip", () => websocket(cells.realtime));
  await step("realtime", "streamed request body", () => echo(cells.realtime));
}
if (cells.data) await selftest("data", cells.data);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
