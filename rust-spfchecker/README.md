# rust-spfchecker

SPF DNS record validator compiled from Rust to WebAssembly. Checks a domain's SPF records for RFC 7208 compliance including the 10-lookup limit, syntax errors, dangerous configurations, and circular includes.

## How it works

1. **Browser** fetches TXT DNS records from `1.1.1.1` (Cloudflare DoH — CORS-enabled) and recursively follows `include:` and `redirect=` directives to collect all referenced domains
2. **All records sent** to the Rust `/analyze` endpoint as a single JSON POST
3. **Rust parses and validates** the full SPF tree against RFC 7208 rules
4. **Browser renders** a color-coded analysis with per-mechanism detail

The DNS-over-HTTP lookups happen client-side; Rust handles all validation logic.

## RFC 7208 checks

| Code | Severity | Rule |
|------|----------|------|
| `TOO_MANY_LOOKUPS` | error | More than 10 DNS lookups (§4.6.4) |
| `NEAR_LOOKUP_LIMIT` | warning | 8–10 lookups used |
| `MULTIPLE_SPF` | error | More than one SPF TXT record on a domain |
| `NO_SPF_ROOT` | error | No SPF record found |
| `PASS_ALL` | error | `+all` allows any server to send mail |
| `PTR_DEPRECATED` | warning | `ptr` mechanism deprecated in RFC 7208 §5.5 |
| `MECHANISM_AFTER_ALL` | warning | Mechanisms after `all` are unreachable |
| `MISSING_ALL` | warning | No `all` fallback — unauthenticated mail result undefined |
| `SPF_LOOP` | error | Circular `include:` chain detected |
| `UNKNOWN_MECHANISM` | warning | Unrecognised token |
| `EMPTY_MECHANISM_VALUE` | error | `include:` or `a:` with empty value |

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML UI |
| `POST` | `/analyze` | JSON: `{ domain, dns_records }` → analysis |

## Build

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/):

```bash
wasm-pack build --target web --out-dir pkg
```

## Deploy

```bash
ribo deploy
```

## Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | SPF parser, RFC validator, HTTP handler |
| `src/page.html` | UI — DNS fetching, result rendering |
| `Cargo.toml` | Rust package config |
| `ribo.toml` | Tissue deploy config |
