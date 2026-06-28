# js-api-racer

Fans out HTTP requests to six public APIs simultaneously from the Tissue edge, measures per-API latency, and displays results in a live dashboard.

## What it shows

- `Promise.all` for true concurrent outbound fetch
- Wall-clock vs summed latency (parallelism factor)
- Latency is measured **from the cell** — not from the browser

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML dashboard |
| `GET` | `/race/json` | Full JSON results after all APIs complete |

## Deploy

```bash
ribo deploy
```

## Try it

```bash
curl https://<slug>.dev.tissue.systems/race/json
```

## APIs called

GitHub Zen · JSONPlaceholder · Dog CEO · Chuck Norris · Open-Meteo · httpbin UUID
