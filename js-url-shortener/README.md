# js-url-shortener

URL shortener Cell. Creates short codes, tracks click counts, and issues `301` redirects.

## Setup

```bash
ribo db create urls
ribo deploy
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
```

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
URL=http://localhost:8080/<addr>

# create a short link
curl -X POST $URL/shorten -d '{"url":"https://example.com","code":"ex"}'

# follow the redirect
curl -L $URL/ex

# custom code
curl -X POST $URL/shorten -d '{"url":"https://tissue.systems"}'

# check click counts
curl $URL/links
```

## What this demonstrates

- Cells can return any HTTP status code and headers, not just JSON 200s
- `301` redirects: return `{ status: 301, headers: { location: "..." }, body: "" }`
- C3 as a persistent counter store (click tracking with `UPDATE ... SET clicks = clicks + 1`)
- Input validation and 409 Conflict on duplicate codes
