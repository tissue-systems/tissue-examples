# rust-spellcheck

A spell-checker cell built in Rust, compiled to WebAssembly.

Implements Levenshtein edit-distance search over an embedded word list.  
Shows how to write a full HTTP handler in Rust that runs on tissue.

## What it does

- `GET /` — HTML page with a word input and debounced live search
- `POST /check` — JSON API: `{"word":"..."}` → top 8 closest matches with edit distances

## Build

Requires [wasm-pack](https://rustwasm.github.io/wasm-pack/):

```bash
wasm-pack build --target web --out-dir pkg
```

## Deploy

```bash
ribo deploy
```

## Rust → WASM architecture

The Rust library exports a single `fetch(req_json: String) -> JsValue` function via
`wasm-bindgen`. The tissue runtime wraps it: when an HTTP request arrives the router
serialises `{method, url, headers, body}` to JSON, calls `wasmFetch`, and converts the
returned `{status, headers, body}` object into an HTTP response.

This means Rust code handles routing, HTML generation, and all business logic — no JS
glue in the cell itself.

## Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | Rust HTTP handler + Levenshtein algorithm |
| `src/dictionary.txt` | Embedded word list (included at compile time) |
| `Cargo.toml` | Rust package config |
| `ribo.toml` | Tissue deploy config |
| `pkg/` | wasm-pack output (commit for deploy-without-build) |
