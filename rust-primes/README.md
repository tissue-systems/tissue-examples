# rust-primes

Prime counter in Rust/WASM demonstrating async Rust futures compiled to WebAssembly.
Exported functions return `Promise<number>` via `wasm-bindgen-futures`.

## Deploy

```bash
ribo deploy    # runs wasm-pack build --target web
```

## Invoke

```bash
ADDR=<addr>

# count primes in [2, 100000)
curl -X POST http://localhost:8080/invoke/$ADDR/count_primes_async \
     -d '{"args":[2,100000]}'

# count two ranges "concurrently" (they run sequentially — see below)
curl -X POST http://localhost:8080/invoke/$ADDR/count_primes_joined \
     -d '{"args":[2,50000,50000,100000]}'
```

## What this demonstrates

- `wasm_bindgen_futures::future_to_promise` — wrapping a Rust async fn as a JS Promise
- **CPU-bound futures are not parallel**: `future::join` on synchronous work runs range 1
  to completion before range 2 starts, because neither future ever yields mid-computation
- Async Rust in WASM is cooperative, not parallel — true in any single-threaded V8 environment
- Compare with `rust-analyst` which uses `yield_now()` to make interleaving explicit
