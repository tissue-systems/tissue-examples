# js-ai-agent

Stateful AI agent with per-session conversation memory persisted in C3.
Each session accumulates its full message history; that history is replayed to Claude
on every turn so the agent remembers what was said earlier in the conversation.
Multiple sessions are fully isolated from each other.

**Requires an Anthropic API key** (`sk-ant-...`).

## Setup

```bash
ribo db create agent
ribo vault set agent ANTHROPIC_API_KEY
openssl rand -hex 32 | ribo vault set agent ACCESS_TOKEN
ribo deploy
URL=https://agent.<your-subdomain>.tissue.dev
AUTH="Authorization: Bearer $ACCESS_TOKEN"
curl -X POST -H "$AUTH" $URL/init
```

Every route needs the token. Until both secrets are set, the Cell answers 503. The
history of every session is readable by whoever holds the token, so don't hand it out
the way you'd hand out a public URL.

To change the system prompt, uncomment the `SYSTEM_PROMPT` text binding in `ribo.toml`
and redeploy.

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create schema (sessions, messages) |
| `POST` | `/sessions` | — | Create a new session → `{ session_id }` |
| `GET` | `/sessions` | — | List all sessions with turn counts |
| `POST` | `/sessions/:id/message` | `{ content }` | Send a message, get AI reply |
| `GET` | `/sessions/:id/history` | — | Full conversation history for a session |
| `DELETE` | `/sessions/:id` | — | Clear a session's messages (keeps the session) |

## Try it

```bash
# start a session
SESSION=$(curl -s -X POST -H "$AUTH" $URL/sessions | jq -r .session_id)

# multi-turn conversation — agent remembers earlier turns
curl -s -X POST -H "$AUTH" $URL/sessions/$SESSION/message \
     -d '{"content":"My name is Alice. Remember that."}' | jq .reply

curl -s -X POST -H "$AUTH" $URL/sessions/$SESSION/message \
     -d '{"content":"What is my name?"}' | jq .reply

# inspect history
curl -H "$AUTH" $URL/sessions/$SESSION/history | jq .

# start a second, isolated session
SESSION2=$(curl -s -X POST -H "$AUTH" $URL/sessions | jq -r .session_id)
curl -s -X POST -H "$AUTH" $URL/sessions/$SESSION2/message \
     -d '{"content":"What is my name?"}' | jq .reply
# → agent has no idea — different session, no memory of Alice
```

## Schema

```sql
sessions  (id TEXT PK, created_at, updated_at)
messages  (id INTEGER PK, session_id, role CHECK('user'|'assistant'), content, created_at)
```

## What this demonstrates

- **Stateful serverless**: the Cell itself is stateless (fresh isolate per request),
  but state lives in C3, so you get durable, queryable memory for free
- **Conversation replay**: history loaded from C3 and sent to the API on every turn;
  no in-memory accumulation, no sticky sessions, no servers to keep warm
- **Session isolation**: each session's history is replayed only into its own turns
  (the last 50 messages). It is not a per-user boundary: one token sees every session
- **C3 as agent memory**: the same pattern scales to tool call logs, embeddings,
  retrieved documents, or any other persistent agent state
