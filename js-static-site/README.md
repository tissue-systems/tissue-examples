# js-static-site

Demonstrates pure static file serving — the Tissue equivalent of Cloudflare Pages.

No JavaScript worker code is needed. `ribo deploy` synthesises a minimal
pass-through worker automatically and uploads every file in `./public` to a
dedicated object-storage bucket.

## ribo.toml

```toml
[cell]
name   = "static-site"
static = "./public"
```

That's the entire config. Deploy with:

```sh
ribo deploy
```

## How it works

`ribo deploy` detects `static = "..."`, then:

1. Derives a bucket name from the cell address (e.g. `abc123-files`).
2. Creates the bucket in Garage via the G7 service (idempotent).
3. Uploads every file under `./public` with the correct `Content-Type`.
4. Synthesises this worker and deploys it as a normal JS cell:
   ```js
   export default { async fetch(req, env) { return env.FILES.fetch(req); } };
   ```

## Routing behaviour

| Request             | Served file            |
|---------------------|------------------------|
| `/`                 | `public/index.html`    |
| `/about`            | `public/about/index.html` |
| `/css/style.css`    | `public/css/style.css` |
| `/missing`          | `public/404.html` (HTTP 404) |

## Mixing static files with dynamic logic

If you need both, use a normal JS cell with an explicit `FILES` binding:

```toml
[cell]
name = "hybrid-site"
js   = "./worker.js"

[[bindings]]
type    = "files"
binding = "FILES"
dir     = "./public"
```

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.FILES.fetch(request);
  }
};
```
