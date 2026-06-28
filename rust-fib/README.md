# rust-fib

Fibonacci in plain Rust/WASM — no `wasm-bindgen`, no JS glue.
Uses a raw `#[no_mangle] extern "C"` export and the legacy numeric-argument invoke route.

## Deploy

```bash
ribo deploy    # runs: cargo build --target wasm32-unknown-unknown --release
```

## Invoke

```bash
# POST /invoke/<addr>/fibonacci  with JSON {"args":[n]}
curl -X POST http://localhost:8080/invoke/<addr>/fibonacci -d '{"args":[10]}'
# → {"result": 55, ...}

# or via query string
curl 'http://localhost:8080/invoke/<addr>/fibonacci?args=10'
```

## What this demonstrates

- The simplest possible WASM Cell: one `#[no_mangle]` function, no dependencies
- Legacy `/invoke/:addr/:fn` route for plain-WASM numeric calls
- The distinction between plain-WASM cells (numeric args, `/invoke`) and
  wasm-bindgen cells (HTTP handler, `/<addr>/*`)
- `cargo build --target wasm32-unknown-unknown` as the build command (no wasm-pack needed)
