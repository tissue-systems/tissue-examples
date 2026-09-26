// Realtime and runtime tour. /selftest runs the checks that fit in one request;
// /sse, /ws and /echo need a client on the other end and are exercised by
// ../smoke.mjs.

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

// Set by a waitUntil task on one request and read back by the next one in the
// same isolate. Isolates are recycled, so /selftest reports it without failing.
let lastBackgroundRun = null;

async function selftest(request) {
  const checks = [];

  checks.push(await check("crypto.randomUUID", async () => {
    const id = crypto.randomUUID();
    assert(/^[0-9a-f-]{36}$/.test(id), id);
    return id;
  }));

  checks.push(await check("subtle HMAC-SHA256 sign + verify", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const data = new TextEncoder().encode("tour-realtime");
    const sig = await crypto.subtle.sign("HMAC", key, data);
    assert(await crypto.subtle.verify("HMAC", key, sig, data), "verify failed");
    return `${sig.byteLength}-byte signature`;
  }));

  checks.push(await check("subtle SHA-256 digest", async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
    const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    assert(hex === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
    return hex.slice(0, 16);
  }));

  checks.push(await check("gzip round trip", async () => {
    const input = "tissue ".repeat(2000);
    const gz = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
    const packed = await new Response(gz).arrayBuffer();
    const back = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    assert(back === input, "decompressed text differs");
    return `${input.length} -> ${packed.byteLength} bytes`;
  }));

  checks.push(await check("TransformStream", async () => {
    const upper = new TransformStream({
      transform(chunk, ctl) { ctl.enqueue(chunk.toUpperCase()); },
    });
    const out = await new Response(
      new Blob(["abc", "def"]).stream().pipeThrough(new TextDecoderStream()).pipeThrough(upper).pipeThrough(new TextEncoderStream()),
    ).text();
    assert(out === "ABCDEF", out);
    return out;
  }));

  checks.push(await check("outbound fetch", async () => {
    const res = await fetch("https://tissue.systems/", { redirect: "manual" });
    assert(res.status > 0 && res.status < 500, `status ${res.status}`);
    await res.body?.cancel();
    return `tissue.systems answered ${res.status}`;
  }));

  checks.push(await check("URL + URLSearchParams", async () => {
    const u = new URL("/a/b?x=1&y=two", request.url);
    assert(u.searchParams.get("y") === "two", u.search);
    return u.pathname;
  }));

  checks.push(await check("Intl + Date", async () => {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" }).format(new Date(0));
    assert(s.includes("1969"), s);
    return s;
  }));

  checks.push({ name: "waitUntil (last background run, informational)", ok: true, detail: lastBackgroundRun });

  return checks;
}

function sse() {
  const enc = new TextEncoder();
  let n = 0;
  let timer;
  const body = new ReadableStream({
    start(ctl) {
      ctl.enqueue(enc.encode(": stream open\n\n"));
      timer = setInterval(() => {
        n += 1;
        ctl.enqueue(enc.encode(`id: ${n}\nevent: tick\ndata: ${JSON.stringify({ n, at: new Date().toISOString() })}\n\n`));
        if (n === 5) {
          clearInterval(timer);
          ctl.enqueue(enc.encode("event: done\ndata: {}\n\n"));
          ctl.close();
        }
      }, 200);
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

function websocket(request) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a WebSocket upgrade", { status: 426 });
  }
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ hello: "tour-realtime" }));
  server.addEventListener("message", (ev) => {
    if (ev.data === "close") {
      server.close(1000, "bye");
      return;
    }
    server.send(JSON.stringify({ echo: ev.data }));
  });
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/selftest": {
        const checks = await selftest(request);
        ctx.waitUntil((async () => {
          await new Promise((r) => setTimeout(r, 50));
          lastBackgroundRun = new Date().toISOString();
        })());
        const ok = checks.every((c) => c.ok);
        return Response.json({ cell: "tour-realtime", ok, checks }, { status: ok ? 200 : 503 });
      }
      case "/sse":
        return sse();
      case "/ws":
        return websocket(request);
      case "/echo":
        // Streams the request body straight back, uppercased, without buffering.
        if (request.method !== "POST" || !request.body) return new Response("POST a body", { status: 400 });
        return new Response(
          request.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
            transform(chunk, ctl) { ctl.enqueue(chunk.toUpperCase()); },
          })).pipeThrough(new TextEncoderStream()),
          { headers: { "content-type": "text/plain" } },
        );
      case "/headers":
        return Response.json(Object.fromEntries(request.headers));
      default:
        return new Response("tour-realtime: /selftest /sse /ws /echo /headers\n");
    }
  },
};
