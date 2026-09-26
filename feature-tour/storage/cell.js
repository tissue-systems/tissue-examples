// Storage tour. Each check returns { name, ok, detail } and /selftest answers
// 503 if any one of them fails, so a monitor can watch the status code alone.

const PULSE_KEY = "pulse/last.json";
// A pulse fires once a minute and the scheduler polls every 30 s, so anything
// older than three minutes means ticks are being missed.
const PULSE_MAX_AGE_MS = 3 * 60 * 1000;

async function check(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (err) {
    return { name, ok: false, detail: String(err && err.message || err) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function selftest(env) {
  const run = crypto.randomUUID();
  const textKey = `selftest/${run}.txt`;
  const binKey = `selftest/${run}.bin`;
  const bytes = crypto.getRandomValues(new Uint8Array(4096));

  const checks = [];

  checks.push(await check("g7 put + get text", async () => {
    await env.BUCKET.put(textKey, `run ${run}`, { contentType: "text/plain" });
    const res = await env.BUCKET.get(textKey);
    assert(res, "get returned null after put");
    const body = await res.text();
    assert(body === `run ${run}`, `read back ${JSON.stringify(body)}`);
    return `${body.length} bytes, content-type ${res.headers.get("content-type")}`;
  }));

  checks.push(await check("g7 put + get binary", async () => {
    await env.BUCKET.put(binKey, bytes.buffer, { contentType: "application/octet-stream" });
    const res = await env.BUCKET.get(binKey);
    assert(res, "get returned null after put");
    const back = new Uint8Array(await res.arrayBuffer());
    assert(back.length === bytes.length, `length ${back.length}, want ${bytes.length}`);
    assert(back.every((b, i) => b === bytes[i]), "bytes differ");
    return `${back.length} bytes match`;
  }));

  checks.push(await check("g7 head", async () => {
    const meta = await env.BUCKET.head(binKey);
    assert(meta, "head returned null");
    assert(meta.size === bytes.length, `size ${meta.size}`);
    return meta;
  }));

  checks.push(await check("g7 list by prefix", async () => {
    const { objects } = await env.BUCKET.list({ prefix: `selftest/${run}` });
    const keys = objects.map((o) => o.key).sort();
    assert(keys.length === 2, `listed ${JSON.stringify(keys)}`);
    return keys;
  }));

  checks.push(await check("g7 delete", async () => {
    await env.BUCKET.delete(textKey);
    await env.BUCKET.delete(binKey);
    assert((await env.BUCKET.get(textKey)) === null, "text object still there");
    assert((await env.BUCKET.head(binKey)) === null, "binary object still there");
    return "both objects gone";
  }));

  checks.push(await check("g7 missing key is null", async () => {
    assert((await env.BUCKET.get(`selftest/${run}.nope`)) === null, "expected null");
    return "null";
  }));

  checks.push(await check("files get", async () => {
    const res = await env.ASSETS.get("data.json");
    assert(res, "data.json missing from the FILES bucket");
    const data = await res.json();
    assert(data.source === "files binding", JSON.stringify(data));
    return data;
  }));

  checks.push(await check("files fetch", async () => {
    const res = await env.ASSETS.fetch(new Request("https://cell/index.html"));
    assert(res.status === 200, `status ${res.status}`);
    const html = await res.text();
    assert(html.includes("tour-storage"), "index.html content not served");
    return `${res.status}, ${html.length} bytes`;
  }));

  checks.push(await check("text binding", async () => {
    assert(env.GREETING === "hello from a text binding", `got ${JSON.stringify(env.GREETING)}`);
    return env.GREETING;
  }));

  checks.push(await check("pulse wrote recently", async () => {
    const res = await env.BUCKET.get(PULSE_KEY);
    assert(res, "no pulse has fired yet (wait a minute after the first deploy)");
    const last = await res.json();
    const age = Date.now() - Date.parse(last.scheduledTime);
    assert(age < PULSE_MAX_AGE_MS, `last pulse ${Math.round(age / 1000)} s ago`);
    return { ...last, ageSeconds: Math.round(age / 1000) };
  }));

  return checks;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/selftest") {
      const checks = await selftest(env);
      const ok = checks.every((c) => c.ok);
      return Response.json({ cell: "tour-storage", ok, checks }, { status: ok ? 200 : 503 });
    }

    // Webhook receiver for a vesicle endpoint bound with route "/hook".
    if (url.pathname === "/hook" && request.method === "POST") {
      const body = await request.text();
      const key = `hooks/${Date.now()}-${crypto.randomUUID()}.json`;
      await env.BUCKET.put(key, JSON.stringify({
        receivedAt: new Date().toISOString(),
        headers: Object.fromEntries(request.headers),
        body,
      }), { contentType: "application/json" });
      return Response.json({ stored: key });
    }

    if (url.pathname === "/hooks") {
      const { objects } = await env.BUCKET.list({ prefix: "hooks/" });
      const recent = objects.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 10);
      const items = await Promise.all(recent.map(async (o) => (await env.BUCKET.get(o.key)).json()));
      return Response.json({ count: objects.length, recent: items });
    }

    return env.ASSETS.fetch(request);
  },

  async pulse(event, env) {
    const prev = await env.BUCKET.get(PULSE_KEY);
    const count = prev ? ((await prev.json()).count || 0) + 1 : 1;
    await env.BUCKET.put(PULSE_KEY, JSON.stringify({
      scheduledTime: new Date(event.scheduledTime).toISOString(),
      cron: event.cron,
      count,
    }), { contentType: "application/json" });
  },
};
