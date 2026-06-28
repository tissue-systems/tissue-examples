# js-hello

Minimal JS Cell. No database. Shows the bare cell contract and basic HTTP routing.

## Deploy

```bash
ribo deploy
# deployed  hello
# address   cgyhmi
# url       http://localhost:8080/cgyhmi
```

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Returns `{ message, method, path }` |
| `GET` | `/hello/:name` | Returns `{ greeting: "Hello, <name>!" }` |
| `POST` | `/echo` | Echoes the request body |

## Try it

```bash
URL=http://localhost:8080/<addr>

curl $URL/
curl $URL/hello/world
curl -X POST $URL/echo -d '{"ping":true}'
```

## What this demonstrates

- Smallest possible Cell — `ribo.toml` with just `name` and `js`, no build step
- Routing by `method` + path segments parsed from the URL
- The `fetch(request, env, ctx)` export contract — standard Workers `Request`/`Response` objects (WASM Cells use a JSON `req_json`/`{status,headers,body}` contract instead)
