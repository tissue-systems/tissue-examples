# tissue-examples

Example Cells for the [Tissue](https://tissue.systems) edge runtime.

Each subdirectory is a self-contained Cell you can deploy with [`ribo`](https://github.com/tissue-systems/ribo):

```bash
cd <example>
ribo deploy
```

## JavaScript

| Example | What it shows |
|---------|---------------|
| [js-hello](./js-hello) | Minimal cell — routing, JSON responses |
| [js-static-ping](./js-static-ping) | HTML page + JSON API endpoint |
| [js-c3-notes](./js-c3-notes) | C3 SQLite binding — CRUD notes app |
| [js-notes](./js-notes) | Notes app with richer UI |
| [js-url-shortener](./js-url-shortener) | URL shortener backed by C3 |
| [js-api-racer](./js-api-racer) | Parallel fetch to 6 public APIs, latency benchmark |
| [js-ai-agent](./js-ai-agent) | LLM agent via Anthropic API |
| [js-llm-chat](./js-llm-chat) | Streaming LLM chat UI |
| [js-growzone](./js-growzone) | USDA plant hardiness zone lookup by US zip code |
| [js-stream-demo](./js-stream-demo) | Streaming request/response bodies — SSE, full-duplex echo, incremental reads |
| [qrcode-label](./qrcode-label) | Sci-fi asset label generator with styled QR codes — FILES binding |
| [js-doc-markup](./js-doc-markup) | Collaborative PDF markup — pdf.js + shared 3-letter sessions, live strokes/text/cursors over SSE, C3 + G7 bindings |
| [js-live-canvas](./js-live-canvas) | Real-time shared canvas — live cursors + collaborative drawing over SSE, durable strokes in C3 vs ephemeral in-memory cursors |
| [js-jsonb-demo](./js-jsonb-demo) | SQLite JSONB in C3 — binary JSON storage, json_extract / ->> / jsonb_set, TEXT-vs-JSONB comparison |

## Sensors (Synapse)

| Example | What it shows |
|---------|---------------|
| [sense-coldchain](./sense-coldchain) | Cold-chain temperature monitoring — Synapse sensor ingest + C3 excursion log, time-in-range compliance, CSV export, live dashboard |

## Rust → WASM

| Example | What it shows |
|---------|---------------|
| [rust-fib](./rust-fib) | Fibonacci — minimal Rust WASM cell |
| [rust-primes](./rust-primes) | Prime sieve, CPU-bound computation |
| [rust-analyst](./rust-analyst) | Text analysis (word frequency, readability) |
| [rust-phonebook](./rust-phonebook) | In-memory phonebook with Rust data structures |
| [rust-spellcheck](./rust-spellcheck) | Levenshtein spell checker over 210k-word dictionary |
| [rust-spfchecker](./rust-spfchecker) | SPF DNS record validator — RFC 7208 compliance analysis |

## TypeScript

| Example | What it shows |
|---------|---------------|
| [ts-events-api](./ts-events-api) | TypeScript cell with esbuild compile step |

## Prerequisites

- [ribo](https://github.com/tissue-systems/ribo) — Tissue deploy CLI
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) — for Rust examples
- Rust toolchain with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
