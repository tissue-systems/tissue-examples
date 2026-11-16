# js-llm-chat

Stateless LLM chat Cell. Each request is independent, with no history between calls.
Calls the Anthropic Messages API. The API key is a vault binding, so it never appears in
source, and every chat call needs an access token so strangers can't spend it.

**Requires an Anthropic API key** (`sk-ant-...`).

## Setup

```bash
ribo vault set llm-chat ANTHROPIC_API_KEY
openssl rand -hex 32 | ribo vault set llm-chat ACCESS_TOKEN
ribo deploy
```

Set both before deploying. Until they're set, `/chat` answers 503.

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/chat` | `{ message, model?, system?, max_tokens? }` | Call Claude, return reply. Needs `Authorization: Bearer <ACCESS_TOKEN>` |
| `GET` | `/` | — | Usage info and available models |

## Try it

```bash
URL=https://llm-chat.<your-subdomain>.tissue.dev
AUTH="Authorization: Bearer $ACCESS_TOKEN"

curl -X POST $URL/chat -H "$AUTH" \
     -d '{"message":"What is the capital of France?"}'

# with a custom system prompt and model
curl -X POST $URL/chat -H "$AUTH" -d '{
  "message": "Summarise this in one sentence: Tissue is a serverless WASM runtime.",
  "system": "You are an extremely terse technical writer.",
  "model": "claude-sonnet-4-6"
}'
```

Default model: `claude-haiku-4-5-20251001`. Available: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`. Anything else is refused, and `max_tokens` is capped at 4096.

## What this demonstrates

- Cells can call external HTTP APIs (`globalThis.fetch`, distinct from the exported `fetch`)
- A `vault` binding for the API key: the key name is in `ribo.toml`, the value never is
- A bearer token in front of anything that spends money
- Stateless AI: every call is a fresh context, ideal for one-shot completions and summarisation
- The fresh-isolate-per-request model means no global state leaks between callers
