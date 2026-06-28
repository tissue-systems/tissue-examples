# rust-analyst

Text analysis Cell in Rust/WASM. Runs four analysis passes concurrently using
`future::join4` with explicit `yield_now()` cooperative interleaving.

## Deploy

```bash
ribo deploy    # runs wasm-pack build --target web
```

## Invoke

```bash
curl -X POST http://localhost:8080/invoke/<addr>/analyse \
     -d "The quick brown fox jumps over the lazy dog"
```

Response fields: `word_count`, `line_count`, `char_count`, `avg_word_length`,
`top_chars`, `longest_word`, `palindrome_count`, `palindrome_examples`, `concurrency_model`.

## What this demonstrates

- `future::join4` running four passes (word count, char frequency, longest word, palindromes)
  that interleave via `yield_now().await` — each pass advances a chunk, yields, then another continues
- `yield_now()` returns `Poll::Pending` exactly once, triggering the executor to poll other futures,
  then immediately reschedules itself — observable, explicit cooperative multitasking
- Why this matters: in a Tissue Cell, there is no thread pool. All futures share
  one thread. `yield_now()` is the only way to give other tasks a turn mid-computation.
- The `concurrency_model` field in the response summarises this for inspection

## Concurrency model summary

```
future::join4(pass_counts, pass_char_freq, pass_longest, pass_palindromes)
              │                │                │               │
              ▼                ▼                ▼               ▼
         chunk→yield      chunk→yield     chunk→yield     chunk→yield
              │                │                ...
              └────────────────┴── single-threaded V8 event loop ──┘
```

All four passes run on the same thread. `yield_now()` makes the interleaving
visible rather than hiding the sequential execution behind a `join!`.
