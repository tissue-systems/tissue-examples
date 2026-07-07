# sense-coldchain

Cold-chain compliance monitor for tissue. Designed for operators who need more than
graphs: **proof of compliance** and an auditable record of every temperature excursion
for fridges, freezers, pharmaceutical cold rooms, or refrigerated vehicles.

Each monitored asset has a safe temperature range [min_c, max_c]. The Cell:

- Tracks when temperature goes out of range ("excursions"), for how long, and how
  far out it peaked.
- Computes time-in-range % over 24 h / 7 d / 30 d windows.
- Exports raw readings or the excursion log as RFC 4180 CSV for auditors.
- Renders a live dashboard with per-asset sparklines and safe-band guide lines.

---

## Deploy

```bash
ribo db create sense-coldchain
ribo deploy
```

---

## Register an asset

An "asset" is a named monitored unit with its own safe range. Register one before
sending data (or let auto-create handle it — see below):

```bash
# Walk-in fridge: safe 0–8 °C
curl -X POST https://<cell-url>/assets \
  -H "Content-Type: application/json" \
  -d '{"device":"dev_abc12345","name":"Walk-in Fridge A","min_c":0,"max_c":8}'

# Pharmaceutical freezer: safe -25 to -15 °C
curl -X POST https://<cell-url>/assets \
  -H "Content-Type: application/json" \
  -d '{"device":"dev_xyz98765","name":"Pharmacy Freezer 1","min_c":-25,"max_c":-15}'
```

The upsert is idempotent — re-POST to change the name or adjust the safe range.

### Auto-create

If a temperature reading arrives for a device that has no asset record yet, the Cell
automatically creates one with name = device id and a default fridge range of 0–8 °C.
This means the Cell works out-of-the-box without manual setup: just start sending data
and fix up the name / range with `POST /assets` afterwards.

---

## Register an HTTP device and send readings

For the HTTP path (no synapse required):

```bash
# 1. Register a device — save the api_key
curl -X POST https://<cell-url>/devices \
  -H "Content-Type: application/json" \
  -d '{"name":"Walk-in Fridge A"}'
# → { "id": "dev_abc12345", "name": "Walk-in Fridge A", "api_key": "key_…" }

# 2. Register the asset with the device id from step 1
curl -X POST https://<cell-url>/assets \
  -H "Content-Type: application/json" \
  -d '{"device":"dev_abc12345","name":"Walk-in Fridge A","min_c":0,"max_c":8}'

# 3. Send a temperature reading
curl -X POST https://<cell-url>/readings \
  -H "Content-Type: application/json" \
  -H "x-device-key: key_…" \
  -d '{"metric":"temperature","value":5.2,"unit":"C"}'
```

---

## Drive with sensor-test

Build sensor-test once: `cd ../sensor-test && cargo build --release`

```bash
# HTTP transport (no synapse needed): cold-fridge profile (~2–7 °C, rarely exceeds 8)
sensor-test --transport http --cell-url https://<cell-url> \
  --profile cold-fridge --sensors 3

# HTTP transport: freezer profile (~-22 to -18 °C)
# Register your asset with min_c=-25, max_c=-15 first so it uses freezer range.
sensor-test --transport http --cell-url https://<cell-url> \
  --profile freezer --sensors 2

# Force excursions: day-night profile swings widely — set a tight safe range to
# guarantee violations. Register the asset with e.g. min_c=4, max_c=6 first.
sensor-test --transport http --cell-url https://<cell-url> \
  --profile day-night --sensors 1

# Fast replay at 60× time compression to fill history quickly
sensor-test --transport http --cell-url https://<cell-url> \
  --profile day-night --sensors 2 --time-scale 60 --duration 120

# MQTT → synapse → sensor() (once synapse is running):
sensor-test --bearer "$TISSUE_BEARER" --cell sense-coldchain \
  --profile cold-fridge --sensors 5
```

---

## CSV export

Download a CSV suitable for auditors or HACCP records:

```bash
# All readings for a device, last 30 days (default window)
curl "https://<cell-url>/export.csv?device=dev_abc12345&what=readings" -o readings.csv

# Excursion log, scoped to a date range
curl "https://<cell-url>/export.csv?device=dev_abc12345&what=excursions&from=2026-06-01T00:00:00Z&to=2026-06-30T00:00:00Z" \
  -o excursions-june.csv
```

The response includes `Content-Disposition: attachment` so browsers save rather than
display the file. Fields containing commas or double-quotes are properly quoted per
RFC 4180.

---

## Compliance API

```bash
curl "https://<cell-url>/api/compliance?device=dev_abc12345&window=24h"
```

```json
{
  "device": "dev_abc12345",
  "window": "24h",
  "from": "2026-06-28T12:00:00.000Z",
  "to":   "2026-06-29T12:00:00.000Z",
  "total_readings": 288,
  "in_range_readings": 275,
  "time_in_range_pct": 95.49,
  "method": "sample-based",
  "note": "Approximation: in-range readings / total readings. Assumes uniform sampling frequency; gaps or bursts reduce accuracy."
}
```

### Time-in-range method

This Cell uses **sample-based compliance**: count temperature readings whose value
falls within [min_c, max_c], divided by total temperature readings in the window,
expressed as a percentage.

**Why this approximation**: It is simple, transparent, and accurate when readings
arrive at a regular interval (which sensor-test guarantees). The alternative — a
time-weighted approach that sums excursion `duration_s` values and subtracts from
the window length — would be more accurate for irregular or gappy data, but requires
careful handling of excursions that straddle window boundaries. The sample-based
method is honest about its assumption and sufficient for the example use case.

---

## Excursion tracking (stateless)

Cells are stateless between requests — each fetch/sensor invocation is independent.
Excursion state is maintained entirely in the database:

1. On every temperature reading, the ingest path queries for an open excursion row
   (`ended_at IS NULL`) for that device.
2. If the temperature is outside [min_c, max_c] and no open row exists → INSERT a
   new excursion row.
3. If out of range and an open row exists → UPDATE peak_c, min_c_seen, duration_s,
   n_readings in place.
4. If back in range and an open row exists → set ended_at and final duration_s.

This means the excursion log survives Cell restarts, redeployments, and cold starts
with no in-memory state required.

---

## Routes reference

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Overview dashboard |
| `POST` | `/assets` | Register or update an asset |
| `GET`  | `/assets` | JSON list of assets |
| `POST` | `/devices` | Register HTTP device → `{ id, api_key }` |
| `GET`  | `/devices` | JSON list of HTTP devices |
| `POST` | `/readings` | Ingest reading (`x-device-key` header) |
| `GET`  | `/asset/:device` | Asset detail: chart, compliance, excursion log |
| `GET`  | `/export.csv` | CSV download (`?device=&what=readings\|excursions`) |
| `GET`  | `/api/compliance` | JSON compliance `?device=&window=24h\|7d` |
