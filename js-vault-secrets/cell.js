/**
 * js-vault-secrets — how a Cell receives and uses encrypted secrets.
 *
 * A `type = "vault"` binding arrives as a plain string on `env`, exactly like a
 * `type = "text"` binding. The difference is where the value lives: text values
 * sit in ribo.toml (git, deploy bundle), vault values are stored encrypted
 * server-side and injected when the Cell instance loads.
 *
 * Routes:
 *   GET  /          → which secrets are configured, by fingerprint — never the value
 *   GET  /health    → 200 if every required secret is present, 503 with the list if not
 *   POST /sign      → HMAC-SHA256 of the body, hex (test helper; gated by a text binding)
 *   POST /webhook   → verifies x-signature against the body, fails closed
 */

const REQUIRED_SECRETS = ["WEBHOOK_SIGNING_SECRET"];
const OPTIONAL_SECRETS = ["UPSTREAM_API_KEY"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const { method } = request;

    if (method === "GET" && path === "/") return index(env);
    if (method === "GET" && path === "/health") return health(env);
    if (method === "POST" && path === "/sign") return sign(request, env);
    if (method === "POST" && path === "/webhook") return webhook(request, env);

    return Response.json({ error: `No route for ${method} ${path}` }, { status: 404 });
  },
};

async function index(env) {
  return Response.json({
    service: env.SERVICE_NAME ?? null,
    secrets: await secretStatus(env),
    signingHelper: helperEnabled(env) ? "enabled" : "disabled",
    routes: {
      "GET /health": "readiness — 503 while a required secret is unset",
      "POST /sign": "HMAC of the request body, hex-encoded",
      "POST /webhook": "verify x-signature against the request body",
    },
  });
}

/**
 * Reports presence, not value. The fingerprint is a truncated hash of the
 * secret, which is how you confirm a rotation actually reached the running Cell
 * (`ribo vault set` alone does not — the value is injected at instance load, so
 * a redeploy is required). Caveat: a fingerprint is only opaque for a
 * high-entropy secret. For something guessable, 8 hex characters are enough to
 * confirm a guess offline — so don't expose this route for a short passphrase.
 */
async function secretStatus(env) {
  const status = {};
  for (const key of [...REQUIRED_SECRETS, ...OPTIONAL_SECRETS]) {
    const value = env[key];
    status[key] = isConfigured(value)
      ? { configured: true, fingerprint: await fingerprint(value) }
      : { configured: false, required: REQUIRED_SECRETS.includes(key) };
  }
  return status;
}

async function health(env) {
  const missing = REQUIRED_SECRETS.filter((key) => !isConfigured(env[key]));
  if (missing.length > 0) return missingSecrets(missing);
  return Response.json({ ok: true });
}

async function sign(request, env) {
  if (!helperEnabled(env)) {
    return Response.json(
      { error: 'Signing helper disabled. Set ENABLE_SIGNING_HELPER = "true" in ribo.toml and redeploy.' },
      { status: 404 },
    );
  }
  const secret = env.WEBHOOK_SIGNING_SECRET;
  if (!isConfigured(secret)) return missingSecrets(["WEBHOOK_SIGNING_SECRET"]);

  const body = await request.text();
  const key = await hmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Response.json({ signature: hex(signature) });
}

async function webhook(request, env) {
  const secret = env.WEBHOOK_SIGNING_SECRET;
  // Fail closed: an unverifiable request is rejected, never accepted on the
  // grounds that the Cell has nothing to check it with.
  if (!isConfigured(secret)) return missingSecrets(["WEBHOOK_SIGNING_SECRET"]);

  const header = request.headers.get("x-signature");
  if (!header) return unauthorized("Missing x-signature header.");

  const provided = unhex(header.trim());
  if (!provided) return unauthorized("x-signature must be hex-encoded.");

  const body = await request.text();
  const key = await hmacKey(secret, ["verify"]);

  // crypto.subtle.verify compares in constant time. Computing the expected
  // signature and testing it with === leaks the correct prefix through response
  // timing, one byte at a time.
  const ok = await crypto.subtle.verify("HMAC", key, provided, new TextEncoder().encode(body));
  if (!ok) return unauthorized("Signature does not match.");

  return Response.json({ ok: true, bytes: body.length });
}

function helperEnabled(env) {
  return env.ENABLE_SIGNING_HELPER === "true";
}

/** A vault binding with no stored value is absent from env, not empty. */
function isConfigured(value) {
  return typeof value === "string" && value.length > 0;
}

function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function fingerprint(value) {
  // Domain-separated so this digest can't be matched against a bare SHA-256 of
  // the same secret taken from somewhere else.
  const data = new TextEncoder().encode(`tissue-vault-fingerprint:${value}`);
  return hex(await crypto.subtle.digest("SHA-256", data)).slice(0, 8);
}

function missingSecrets(missing) {
  return Response.json(
    {
      ok: false,
      missing,
      fix: missing.map((key) => `ribo vault set vault-secrets ${key}`).concat("ribo deploy"),
    },
    { status: 503 },
  );
}

function unauthorized(error) {
  return Response.json({ error }, { status: 401 });
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s) {
  if (s.length === 0 || s.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
