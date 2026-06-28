# js-llm-chat

Stateless LLM chat Cell. Each request is independent — no history between calls.
Calls the Anthropic Messages API; the API key is stored in C3 so it never appears in source.

**Requires an Anthropic API key** (`sk-ant-...`).

## Setup

```bash
ribo db create llm-chat
ribo deploy
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
curl -X POST $URL/configure -d '{"api_key":"sk-ant-..."}'
```

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create config table |
| `POST` | `/configure` | `{ api_key }` | Store Anthropic API key in C3 |
| `POST` | `/chat` | `{ message, model?, system?, max_tokens? }` | Call Claude, return reply |
| `GET` | `/` | — | Usage info and available models |

## Try it

```bash
URL=http://localhost:8080/<addr>

curl -X POST $URL/chat \
     -d '{"message":"What is the capital of France?"}'

# with a custom system prompt and model
curl -X POST $URL/chat -d '{
  "message": "Summarise this in one sentence: Tissue is a serverless WASM runtime.",
  "system": "You are an extremely terse technical writer.",
  "model": "claude-sonnet-4-6"
}'
```

Default model: `claude-haiku-4-5-20251001`. Available: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`.

## What this demonstrates

- Cells can call external HTTP APIs (`globalThis.fetch` — distinct from the exported `fetch`)
- C3 as a config/secrets store: the API key lives in the database, not in code or env vars
- Stateless AI: every call is a fresh context, ideal for one-shot completions and summarisation
- The fresh-isolate-per-request model means no global state leaks between callers
