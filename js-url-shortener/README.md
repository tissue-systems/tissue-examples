# js-url-shortener

URL shortener Cell. Creates short codes, tracks click counts, and issues `301` redirects.

## Setup

```bash
ribo db create urls
openssl rand -hex 32 | ribo vault set url-shortener ADMIN_TOKEN
ribo deploy
```

Everything except following a short link needs the token as a Bearer header. Until
`ADMIN_TOKEN` is set, those routes answer 503. The page at `/` has a field for it.

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create schema (idempotent) |
| `POST` | `/shorten` | `{ url, code? }` | Create short link; auto-generates code if omitted |
| `GET` | `/:code` | — | `301` redirect to original URL, increments click count |
| `GET` | `/links` | — | List all links with click counts |
| `DELETE` | `/:code` | — | Delete a link |

## Try it

```bash
URL=https://url-shortener.<your-subdomain>.tissue.dev
AUTH="Authorization: Bearer $ADMIN_TOKEN"

# create a short link
curl -X POST $URL/shorten -H "$AUTH" -d '{"url":"https://example.com","code":"ex"}'

# follow the redirect
curl -L $URL/ex

# generated code
curl -X POST $URL/shorten -H "$AUTH" -d '{"url":"https://tissue.systems"}'

# check click counts
curl -H "$AUTH" $URL/links
```

## What this demonstrates

- Cells can return any HTTP status code and headers, not just JSON 200s
- `301` redirects: return `{ status: 301, headers: { location: "..." }, body: "" }`
- C3 as a persistent counter store (click tracking with `UPDATE ... SET clicks = clicks + 1`)
- Input validation (codes are 1-32 of `A-Z a-z 0-9 - _`, targets are http or https) and 409 Conflict on duplicate codes
- A vault token guarding every write, so the shortener can't be used as an open redirector
