# js-ai-agent

Stateful AI agent with per-session conversation memory persisted in C3.
Each session accumulates its full message history; that history is replayed to Claude
on every turn so the agent remembers what was said earlier in the conversation.
Multiple sessions are fully isolated from each other.

**Requires an Anthropic API key** (`sk-ant-...`).

## Setup

```bash
ribo db create agent
ribo deploy
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
curl -X POST $URL/configure -d '{"api_key":"sk-ant-..."}'
```

Optionally set a custom system prompt:
```bash
curl -X POST $URL/configure \
     -d '{"api_key":"sk-ant-...","system_prompt":"You are a pirate. Speak accordingly."}'
```

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create schema (sessions, messages, config) |
| `POST` | `/configure` | `{ api_key, system_prompt? }` | Store config in C3 |
| `POST` | `/sessions` | — | Create a new session → `{ session_id }` |
| `GET` | `/sessions` | — | List all sessions with turn counts |
| `POST` | `/sessions/:id/message` | `{ content }` | Send a message, get AI reply |
| `GET` | `/sessions/:id/history` | — | Full conversation history for a session |
| `DELETE` | `/sessions/:id` | — | Clear a session's messages (keeps the session) |

## Try it

```bash
URL=http://localhost:8080/<addr>

# start a session
SESSION=$(curl -s -X POST $URL/sessions | jq -r .session_id)

# multi-turn conversation — agent remembers earlier turns
curl -s -X POST $URL/sessions/$SESSION/message \
     -d '{"content":"My name is Alice. Remember that."}' | jq .reply

curl -s -X POST $URL/sessions/$SESSION/message \
     -d '{"content":"What is my name?"}' | jq .reply

# inspect history
curl $URL/sessions/$SESSION/history | jq .

# start a second, isolated session
SESSION2=$(curl -s -X POST $URL/sessions | jq -r .session_id)
curl -s -X POST $URL/sessions/$SESSION2/message \
     -d '{"content":"What is my name?"}' | jq .reply
# → agent has no idea — different session, no memory of Alice
```

## Schema

```sql
config    (key TEXT PK, value TEXT)
sessions  (id TEXT PK, created_at, updated_at)
messages  (id INTEGER PK, session_id, role CHECK('user'|'assistant'), content, created_at)
```

## What this demonstrates

- **Stateful serverless**: the Cell itself is stateless (fresh isolate per request),
  but state lives in C3 — giving you durable, queryable memory for free
- **Conversation replay**: history loaded from C3 and sent to the API on every turn;
  no in-memory accumulation, no sticky sessions, no servers to keep warm
- **Session isolation**: each session is a separate DB partition; concurrent users
  cannot see each other's conversations
- **C3 as agent memory**: the same pattern scales to tool call logs, embeddings,
  retrieved documents, or any other persistent agent state
