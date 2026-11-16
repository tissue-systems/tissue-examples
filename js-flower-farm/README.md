# js-flower-farm

A dynamic website for a small flower farm, built with a JS cell, a C3 SQLite database for live inventory and a waitlist, and a FILES binding for static assets.

**Live:** https://flower-farm.bestow-75.tissue.dev  
**Admin:** https://flower-farm.bestow-75.tissue.dev/admin

## What it shows

- **Dynamic homepage**: flower availability is read from C3 on every request and rendered server-side
- **Waitlist signup**: visitors pick flowers and leave an email; entries are written to C3
- **Admin stock endpoint**: `POST /stock` lets the farm update availability without redeploying
- **FILES binding**: CSS, images, and inner pages are served from g7 object storage
- **C3 SQLite**: two tables: `stock` (per-flower availability) and `waitlist` (email signups)

## How it works

`cell.js` handles four routes and falls through to `FILES` for everything else:

| Route | What it does |
|---|---|
| `GET /` | Reads `stock` from C3, renders homepage with live badges |
| `POST /notify` | Writes email + selected flowers to `waitlist` in C3 |
| `POST /stock` | Updates `stock` table (needs `STOCK_SECRET`) |
| `GET /admin` | Renders the internal dashboard: stock status + full waitlist (needs `STOCK_SECRET`) |
| `GET /admin/waitlist` | Returns all waitlist entries as JSON (needs `STOCK_SECRET`) |

On first request `ensureTables()` creates the tables and seeds them with sample data if they don't exist yet.

## Structure

```
cell.js         — JS cell: all dynamic routes + FILES fallthrough
ribo.toml       — cell config: js, C3 binding, FILES binding
public/
├── flowers.html    — seasonal availability calendar
├── about.html      — farm story
├── 404.html        — custom not-found page
├── css/
│   └── style.css
└── images/
    ├── hero.jpg
    ├── lavender.jpg
    ├── sunflowers.jpg
    ├── dahlias.jpg
    ├── market.jpg
    ├── bouquet.jpg
    └── farm-field.jpg
```

## Deploy

Create the C3 database first (one-time setup):

```bash
ribo db create flower-farm
```

Set the admin secret, which guards stock updates and the admin pages. Until it's
set those routes answer 503:

```bash
ribo vault set flower-farm STOCK_SECRET
```

Then deploy:

```bash
ribo deploy
```

ribo uploads `public/` to a g7 bucket, deploys `cell.js`, and wires up both bindings. The C3 database is referenced by name in `ribo.toml`, and `cell.js` receives it as `env.DB`.

## Updating stock

```bash
# Mark dahlias as available with a note
curl -X POST https://flower-farm.<your-subdomain>.tissue.dev/stock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STOCK_SECRET" \
  -d '{"flower":"dahlias","inStock":true,"note":"Café au Lait variety"}'
```

## Admin dashboard

Open `/admin` in a browser to see the internal dashboard: current stock status, waitlist demand per flower, and every signup with email and date. The browser asks for a password: any username, and `STOCK_SECRET` as the password.

The JSON endpoint is also available if you need it for scripting:

```bash
curl -H "Authorization: Bearer $STOCK_SECRET" https://flower-farm.<your-subdomain>.tissue.dev/admin/waitlist
```

## Images

Downloaded from [Unsplash](https://unsplash.com). See footer attribution on each page.
