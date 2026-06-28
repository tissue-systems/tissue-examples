# js-growzone

USDA Plant Hardiness Zone lookup by US zip code. Enter any 5-digit US zip to see your grow zone, temperature range, frost dates, and links to local extension services.

Data source: USDA-ARS / Oregon State University PRISM Climate Group (2023 map).

## What it shows

- Embedding a large dataset (1.2 MB CSV, gzip-compressed to ~112 KB) in a cell
- Multi-module JS cell bundled with esbuild
- Clean HTML UI with zone color coding

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | HTML UI with zip code input |
| `GET` | `/api/growzone/:zip` | JSON zone data for a 5-digit zip |

## Example response

```json
{
  "zipCode": "98101",
  "zone": { "full": "8b", "number": 8, "subZone": "b", "name": "Zone 8b" },
  "temperature": { "rangeF": "15 to 20 °F", "rangeC": "-9.4 to -6.7 °C" },
  "location": { "city": "Seattle", "state": "WA", "stateFull": "Washington" },
  "growing": { "season": "long", "lastFrost": "Feb–Mar", "firstFrost": "Nov–Dec" }
}
```

## Deploy

```bash
npm install        # installs esbuild (build dep only)
ribo deploy        # runs esbuild then uploads dist/cell.js
```

## Files

| File | Purpose |
|------|---------|
| `src/cell.js` | Cell handler + HTML UI |
| `src/data.js` | Embedded USDA zip→zone dataset (base64-gzipped CSV) |
| `ribo.toml` | Tissue deploy config with esbuild build step |
| `package.json` | esbuild dev dependency |
