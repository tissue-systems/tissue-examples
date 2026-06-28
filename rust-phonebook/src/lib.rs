/*!
 * wasm-phonebook — CRUD phone-number Cell for the Tissue runtime.
 *
 * Routes:
 *   GET    /                  serve HTML UI
 *   POST   /init              create the table (idempotent)
 *   POST   /contacts          create a contact    { name, phone }
 *   GET    /contacts          list all contacts
 *   GET    /contacts/:id      get one contact
 *   PATCH  /contacts/:id      update contact      { name?, phone? }
 *   DELETE /contacts/:id      delete a contact
 */

use js_sys::{Array, Function, Promise, Reflect};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

static HTML: &str = include_str!("page.html");

// ── C3 access helpers ─────────────────────────────────────────────────────────

fn get_db() -> Result<JsValue, JsValue> {
    let env = Reflect::get(&js_sys::global(), &"env".into())
        .unwrap_or(JsValue::UNDEFINED);
    if env.is_undefined() || env.is_null() {
        return Err(js_err(
            "globalThis.env not set — add a [[bindings]] c3 entry in ribo.toml",
        ));
    }
    let db = Reflect::get(&env, &"DB".into()).unwrap_or(JsValue::UNDEFINED);
    if db.is_undefined() || db.is_null() {
        return Err(js_err(
            "env.DB not bound — binding name in ribo.toml must be \"DB\"",
        ));
    }
    Ok(db)
}

fn js_call(obj: &JsValue, method: &str, args: &[JsValue]) -> Result<JsValue, JsValue> {
    let f: Function = Reflect::get(obj, &method.into())?.unchecked_into();
    let js_args: Array = args.iter().cloned().collect();
    Reflect::apply(&f, obj, &js_args)
}

async fn c3_query(sql: &str, params: &[JsValue]) -> Result<Vec<Value>, JsValue> {
    let db = get_db()?;
    let stmt = js_call(&db, "prepare", &[sv(sql)])?;
    let stmt = if params.is_empty() { stmt } else { js_call(&stmt, "bind", params)? };
    let result_js =
        JsFuture::from(js_call(&stmt, "all", &[])?.unchecked_into::<Promise>()).await?;
    let data: Value = serde_wasm_bindgen::from_value(result_js)
        .map_err(|e| js_err(e.to_string()))?;
    Ok(data["results"].as_array().cloned().unwrap_or_default())
}

async fn c3_run(sql: &str, params: &[JsValue]) -> Result<Value, JsValue> {
    let db = get_db()?;
    let stmt = js_call(&db, "prepare", &[sv(sql)])?;
    let stmt = if params.is_empty() { stmt } else { js_call(&stmt, "bind", params)? };
    let result_js =
        JsFuture::from(js_call(&stmt, "run", &[])?.unchecked_into::<Promise>()).await?;
    serde_wasm_bindgen::from_value(result_js).map_err(|e| js_err(e.to_string()))
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct CellRequest {
    method: String,
    url: String,
    #[allow(dead_code)]
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
struct CellResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn sv(s: &str) -> JsValue { JsValue::from_str(s) }
fn iv(n: i64) -> JsValue { JsValue::from_f64(n as f64) }

fn js_err(msg: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&msg.to_string())
}

fn rows_affected(meta: &Value) -> u64 {
    meta["meta"]["rows_affected"].as_u64().unwrap_or(0)
}

fn json_content() -> HashMap<String, String> {
    [("content-type".to_string(), "application/json".to_string())].into_iter().collect()
}

fn html_content() -> HashMap<String, String> {
    [("content-type".to_string(), "text/html;charset=utf-8".to_string())].into_iter().collect()
}

fn respond(status: u16, body: Value) -> Result<JsValue, JsValue> {
    let r = CellResponse { status, headers: json_content(), body: serde_json::to_string(&body).unwrap_or_default() };
    serde_wasm_bindgen::to_value(&r).map_err(|e| js_err(e))
}

fn respond_html(body: &str) -> Result<JsValue, JsValue> {
    let r = CellResponse { status: 200, headers: html_content(), body: body.to_string() };
    serde_wasm_bindgen::to_value(&r).map_err(|e| js_err(e))
}

// Extract path from a URL string: "http://host/contacts/1" → "/contacts/1"
fn url_path(url: &str) -> &str {
    let s = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")).unwrap_or(url);
    let after_host = s.find('/').map(|i| &s[i..]).unwrap_or("/");
    // Strip query string
    after_host.find('?').map(|i| &after_host[..i]).unwrap_or(after_host)
}

fn parse_id(segment: &str) -> Result<i64, JsValue> {
    segment.parse::<i64>().map_err(|_| js_err(format!("invalid id: {segment}")))
}

fn parse_body(body: Option<String>) -> Result<Value, JsValue> {
    match body {
        Some(b) if !b.is_empty() => {
            serde_json::from_str(&b).map_err(|e| js_err(format!("invalid JSON body: {e}")))
        }
        _ => Err(js_err("request body is required")),
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub async fn fetch(request_json: String) -> Result<JsValue, JsValue> {
    let req: CellRequest = serde_json::from_str(&request_json)
        .map_err(|e| js_err(format!("bad request envelope: {e}")))?;

    let path = url_path(&req.url);
    // Split path into segments: "/contacts/1" → ["contacts", "1"]
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Auto-create the table on every request so the cell works on first visit.
    do_init().await.ok();

    match (req.method.to_uppercase().as_str(), parts.as_slice()) {
        // GET / — HTML UI
        ("GET", []) => respond_html(HTML),

        // POST /init — create schema (idempotent)
        ("POST", ["init"]) => do_init().await,

        // POST /contacts — create
        ("POST", ["contacts"]) => {
            let body = parse_body(req.body)?;
            do_create(body).await
        }

        // GET /contacts — list
        ("GET", ["contacts"]) => do_list().await,

        // GET /contacts/:id — get one
        ("GET", ["contacts", id]) => do_get(parse_id(id)?).await,

        // PATCH /contacts/:id — update
        ("PATCH", ["contacts", id]) => {
            let body = parse_body(req.body)?;
            do_update(parse_id(id)?, body).await
        }

        // DELETE /contacts/:id — delete
        ("DELETE", ["contacts", id]) => do_delete(parse_id(id)?).await,

        _ => respond(
            404,
            json!({
                "error": "not found",
                "hint": "routes: POST /init, GET|POST /contacts, GET|PATCH|DELETE /contacts/:id"
            }),
        ),
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn do_init() -> Result<JsValue, JsValue> {
    c3_run(
        "CREATE TABLE IF NOT EXISTS contacts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            phone      TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )",
        &[],
    )
    .await?;
    respond(200, json!({ "ok": true, "message": "contacts table ready" }))
}

async fn do_create(body: Value) -> Result<JsValue, JsValue> {
    let name = body["name"].as_str().ok_or_else(|| js_err("name is required"))?;
    let phone = body["phone"].as_str().ok_or_else(|| js_err("phone is required"))?;

    c3_run(
        "INSERT INTO contacts (name, phone) VALUES (?, ?)",
        &[sv(name), sv(phone)],
    )
    .await?;

    let mut rows = c3_query(
        "SELECT id, name, phone, created_at FROM contacts ORDER BY id DESC LIMIT 1",
        &[],
    )
    .await?;
    let contact = rows.pop().ok_or_else(|| js_err("insert failed — no row returned"))?;
    respond(201, json!({ "contact": contact }))
}

async fn do_list() -> Result<JsValue, JsValue> {
    let contacts = c3_query(
        "SELECT id, name, phone, created_at FROM contacts ORDER BY name COLLATE NOCASE",
        &[],
    )
    .await?;
    let count = contacts.len();
    respond(200, json!({ "contacts": contacts, "count": count }))
}

async fn do_get(id: i64) -> Result<JsValue, JsValue> {
    let mut rows = c3_query(
        "SELECT id, name, phone, created_at FROM contacts WHERE id = ?",
        &[iv(id)],
    )
    .await?;
    match rows.pop() {
        Some(c) => respond(200, json!({ "contact": c })),
        None => respond(404, json!({ "error": format!("contact {id} not found") })),
    }
}

async fn do_update(id: i64, body: Value) -> Result<JsValue, JsValue> {
    let name = body["name"].as_str();
    let phone = body["phone"].as_str();

    if name.is_none() && phone.is_none() {
        return respond(400, json!({ "error": "provide at least one of: name, phone" }));
    }

    let mut set_parts: Vec<&str> = Vec::new();
    let mut params: Vec<JsValue> = Vec::new();

    if let Some(n) = name  { set_parts.push("name = ?");  params.push(sv(n)); }
    if let Some(p) = phone { set_parts.push("phone = ?"); params.push(sv(p)); }
    params.push(iv(id));

    let sql = format!("UPDATE contacts SET {} WHERE id = ?", set_parts.join(", "));
    let meta = c3_run(&sql, &params).await?;

    if rows_affected(&meta) == 0 {
        return respond(404, json!({ "error": format!("contact {id} not found") }));
    }

    let mut rows = c3_query(
        "SELECT id, name, phone, created_at FROM contacts WHERE id = ?",
        &[iv(id)],
    )
    .await?;
    let contact = rows.pop().unwrap_or(Value::Null);
    respond(200, json!({ "contact": contact }))
}

async fn do_delete(id: i64) -> Result<JsValue, JsValue> {
    let meta = c3_run("DELETE FROM contacts WHERE id = ?", &[iv(id)]).await?;
    if rows_affected(&meta) == 0 {
        respond(404, json!({ "error": format!("contact {id} not found") }))
    } else {
        respond(200, json!({ "deleted": id }))
    }
}
