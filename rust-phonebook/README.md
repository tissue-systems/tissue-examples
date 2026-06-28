# rust-phonebook

Contacts CRUD API written in Rust, compiled to WebAssembly via `wasm-pack`.
Uses the Tissue Cell `fetch` handler model and a C3 database for persistence.
The Rust equivalent of `js-notes` — same API surface, different implementation language.

## Setup

```bash
ribo db create phonebook
ribo deploy            # runs wasm-pack build --target web, uploads pkg/
URL=http://localhost:8080/<addr>
curl -X POST $URL/init
```

## Routes

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/init` | — | Create contacts table (idempotent) |
| `GET` | `/contacts` | — | List all contacts (sorted by name) |
| `GET` | `/contacts/:id` | — | Get one contact |
| `POST` | `/contacts` | `{ name, phone }` | Create contact |
| `PATCH` | `/contacts/:id` | `{ name?, phone? }` | Update contact |
| `DELETE` | `/contacts/:id` | — | Delete contact |

## Try it

```bash
URL=http://localhost:8080/<addr>

curl -X POST $URL/contacts -d '{"name":"Alice","phone":"+1 555 0100"}'
curl -X POST $URL/contacts -d '{"name":"Bob","phone":"+1 555 0200"}'
curl $URL/contacts
curl -X PATCH $URL/contacts/1 -d '{"phone":"+1 555 0199"}'
curl -X DELETE $URL/contacts/2
```

## What this demonstrates

- Rust/wasm-bindgen Cell using the `fetch(request_json: String) → Promise<JsValue>` export
- `serde_json` + `serde-wasm-bindgen` for request/response serialisation
- C3 queries via `globalThis.env.DB` accessed through `js_sys::Reflect`
- `wasm-pack build --target web` + `pkg/cell_bg.wasm` deploy path
- The harness calls `glue.default(wasmBytes)` to init the module before invoking `fetch`
