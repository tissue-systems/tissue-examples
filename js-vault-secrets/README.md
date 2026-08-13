# js-vault-secrets

Encrypted secrets in a Cell: setting them, using them without leaking them, confirming a
rotation landed, and failing loudly when one is missing.

The Cell verifies HMAC-signed webhooks with a signing secret it never has in its source. The
secret lives in the vault; `ribo.toml` carries only the key name.

## Setup

The vault value must exist before the first deploy — a `vault` binding with nothing stored is
absent at runtime (`env.WEBHOOK_SIGNING_SECRET === undefined`), not empty.

```bash
openssl rand -hex 32 | ribo vault set vault-secrets WEBHOOK_SIGNING_SECRET
ribo deploy
```

`ribo vault set` reads the value from a pipe or, on a terminal, from a hidden prompt. It never
reaches `ribo.toml`, git, the deploy bundle, or your shell history.

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Which secrets are configured, each as a fingerprint — never the value |
| `GET` | `/health` | `200` when every required secret is present, `503` with the missing list |
| `POST` | `/sign` | HMAC-SHA256 of the request body, hex — a test helper, gated by a text binding |
| `POST` | `/webhook` | Verifies `x-signature` against the request body |

## Try it

```bash
URL=https://vault-secrets.<your-subdomain>.tissue.dev

curl $URL/
curl $URL/health

BODY='{"event":"order.paid","id":42}'
SIG=$(curl -s -X POST $URL/sign -d "$BODY" | grep -o '[0-9a-f]\{64\}')

curl -X POST $URL/webhook -H "x-signature: $SIG" -d "$BODY"      # {"ok":true,"bytes":30}
curl -X POST $URL/webhook -H "x-signature: $SIG" -d "$BODY tampered"   # 401
curl -X POST $URL/webhook -d "$BODY"                             # 401, no signature
```

Delete the secret and watch the Cell fail closed rather than accept unverified requests:

```bash
ribo vault delete vault-secrets WEBHOOK_SIGNING_SECRET
ribo deploy
curl $URL/health      # 503 {"ok":false,"missing":["WEBHOOK_SIGNING_SECRET"], ...}
```

## Rotation

Two steps, and the second is the one people skip:

```bash
openssl rand -hex 32 | ribo vault set vault-secrets WEBHOOK_SIGNING_SECRET
ribo deploy
```

Vault values are injected when a Cell instance loads. Without the redeploy, an already-running
instance keeps serving with the old value until it is evicted. `GET /` prints a truncated hash
of each secret, so you can watch the fingerprint change and know the rotation reached the code
that is actually running.

A fingerprint is only opaque for a high-entropy secret. Eight hex characters are enough to
confirm a guess against a short passphrase offline, so don't expose one for a weak secret.

## The signing helper

`POST /sign` will sign any body handed to it with the webhook secret. That is a signing oracle:
it lets anyone forge a request the `/webhook` route will accept, which defeats the entire
point. It exists here so the demo is testable with two curl commands, and it is gated on a
plain text binding:

```toml
[[bindings]]
type    = "text"
binding = "ENABLE_SIGNING_HELPER"
value   = "false"
```

Set it to `"false"`, redeploy, and `/sign` returns 404 while `/webhook` keeps working.

## What this demonstrates

- `type = "vault"` versus `type = "text"` — the secret's key name is in git, its value never is,
  while non-secret configuration stays in `ribo.toml` where it is easy to read and diff
- Reading a vault value from `env` exactly like any other string binding, with no Cell-side
  decryption code
- Reporting secret **presence** without echoing the value, and using a domain-separated
  fingerprint to verify a rotation reached the running instance
- Constant-time signature comparison via `crypto.subtle.verify` — computing the expected HMAC
  and testing it with `===` leaks the correct prefix through response timing
- A readiness route that converts a missing secret from a silent misbehaviour into a 503
- Failing closed: a request that cannot be verified is rejected, never accepted because the
  Cell had nothing to check it against

For encryption at rest, when decryption happens, scopes, and auditing, see the
[Vault Security Model](https://docs.tissue.systems/docs/cells/vault-security/).
