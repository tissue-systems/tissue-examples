/*!
 * rust-g7-store — Tissue cell demonstrating g7 object storage from Rust/WASM.
 *
 * Routes:
 *   GET    /           list all objects in the bucket
 *   GET    /:key       download an object (returns raw content + original content-type)
 *   PUT    /:key       upload an object (request body = content, ?ct=mime sets content-type)
 *   DELETE /:key       delete an object
 *
 * Binding expected in ribo.toml:
 *   [[bindings]]
 *   type    = "g7"
 *   binding = "STORE"
 *   bucket  = "my-store"
 */

use js_sys::{Array, Function, Object, Promise, Reflect};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

// ── G7 access helpers ─────────────────────────────────────────────────────────

fn get_bucket(name: &str) -> Result<JsValue, JsValue> {
    let env = Reflect::get(&js_sys::global(), &"env".into()).unwrap_or(JsValue::UNDEFINED);
    let bucket = Reflect::get(&env, &name.into()).unwrap_or(JsValue::UNDEFINED);
    if bucket.is_undefined() || bucket.is_null() {
        return Err(js_err(format!(
            "env.{name} not bound — add a [[bindings]] g7 entry in ribo.toml"
        )));
    }
    Ok(bucket)
}

fn js_call(obj: &JsValue, method: &str, args: &[JsValue]) -> Result<JsValue, JsValue> {
    let f: Function = Reflect::get(obj, &method.into())?.unchecked_into();
    let js_args: Array = args.iter().cloned().collect();
    Reflect::apply(&f, obj, &js_args)
}

async fn g7_get(bucket: &JsValue, key: &str) -> Result<Option<(String, String)>, JsValue> {
    let result = JsFuture::from(
        js_call(bucket, "get", &[sv(key)])?.unchecked_into::<Promise>()
    ).await?;

    if result.is_null() || result.is_undefined() {
        return Ok(None);
    }

    // Extract content-type from response headers (synchronous)
    let headers = Reflect::get(&result, &"headers".into())?;
    let ct = js_call(&headers, "get", &[sv("content-type")])?;
    let content_type = ct.as_string().unwrap_or_else(|| "application/octet-stream".to_string());

    // Read body as text
    let text = JsFuture::from(
        js_call(&result, "text", &[])?.unchecked_into::<Promise>()
    ).await?;

    Ok(Some((text.as_string().unwrap_or_default(), content_type)))
}

async fn g7_put(bucket: &JsValue, key: &str, body: &str, content_type: &str) -> Result<(), JsValue> {
    let opts = Object::new();
    Reflect::set(&opts, &"contentType".into(), &sv(content_type))?;
    JsFuture::from(
        js_call(bucket, "put", &[sv(key), sv(body), opts.into()])?.unchecked_into::<Promise>()
    ).await?;
    Ok(())
}

async fn g7_delete(bucket: &JsValue, key: &str) -> Result<(), JsValue> {
    JsFuture::from(
        js_call(bucket, "delete", &[sv(key)])?.unchecked_into::<Promise>()
    ).await?;
    Ok(())
}

async fn g7_list(bucket: &JsValue, prefix: Option<&str>) -> Result<Value, JsValue> {
    let opts = Object::new();
    if let Some(p) = prefix {
        Reflect::set(&opts, &"prefix".into(), &sv(p))?;
    }
    let result = JsFuture::from(
        js_call(bucket, "list", &[opts.into()])?.unchecked_into::<Promise>()
    ).await?;
    let data: Value = serde_wasm_bindgen::from_value(result).map_err(|e| js_err(e))?;
    Ok(data)
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct CellRequest {
    method: String,
    url: String,
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

fn sv(s: impl AsRef<str>) -> JsValue { JsValue::from_str(s.as_ref()) }

fn js_err(msg: impl std::fmt::Display) -> JsValue { JsValue::from_str(&msg.to_string()) }

fn url_path(url: &str) -> &str {
    let s = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).unwrap_or(url);
    let after_host = s.find('/').map(|i| &s[i..]).unwrap_or("/");
    after_host.find('?').map(|i| &after_host[..i]).unwrap_or(after_host)
}

fn url_query(url: &str) -> HashMap<String, String> {
    let q = url.find('?').map(|i| &url[i + 1..]).unwrap_or("");
    q.split('&')
        .filter_map(|p| {
            let mut parts = p.splitn(2, '=');
            let k = parts.next()?.to_string();
            let v = parts.next().unwrap_or("").to_string();
            if k.is_empty() { None } else { Some((k, v)) }
        })
        .collect()
}

fn respond_json(status: u16, body: Value) -> Result<JsValue, JsValue> {
    let r = CellResponse {
        status,
        headers: [("content-type".to_string(), "application/json".to_string())].into(),
        body: serde_json::to_string(&body).unwrap_or_default(),
    };
    serde_wasm_bindgen::to_value(&r).map_err(|e| js_err(e))
}

fn respond_raw(status: u16, content_type: &str, body: String) -> Result<JsValue, JsValue> {
    let r = CellResponse {
        status,
        headers: [("content-type".to_string(), content_type.to_string())].into(),
        body,
    };
    serde_wasm_bindgen::to_value(&r).map_err(|e| js_err(e))
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub async fn fetch(request_json: String) -> Result<JsValue, JsValue> {
    let req: CellRequest = serde_json::from_str(&request_json)
        .map_err(|e| js_err(format!("bad request envelope: {e}")))?;

    let bucket = get_bucket("STORE")?;
    let path = url_path(&req.url);
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let method = req.method.to_uppercase();

    match (method.as_str(), parts.as_slice()) {
        // GET / — list all objects
        ("GET", []) => {
            let list = g7_list(&bucket, None).await
                .map_err(|e| js_err(format!("list failed: {:?}", e)))?;
            let objects = list["objects"].as_array().cloned().unwrap_or_default();
            respond_json(200, json!({ "objects": objects, "count": objects.len() }))
        }

        // GET /:key — download object
        ("GET", [key]) => {
            match g7_get(&bucket, key).await? {
                None => respond_json(404, json!({ "error": format!("key not found: {key}") })),
                Some((body, content_type)) => respond_raw(200, &content_type, body),
            }
        }

        // PUT /:key — upload object
        // Body = content; optional ?ct=mime query param sets content-type (default: text/plain)
        ("PUT", [key]) => {
            let body = req.body.unwrap_or_default();
            let query = url_query(&req.url);
            let content_type = query
                .get("ct")
                .map(String::as_str)
                .or_else(|| req.headers.get("content-type").map(String::as_str))
                .unwrap_or("text/plain; charset=utf-8");
            g7_put(&bucket, key, &body, content_type).await?;
            respond_json(201, json!({ "ok": true, "key": key, "size": body.len() }))
        }

        // DELETE /:key — delete object
        ("DELETE", [key]) => {
            g7_delete(&bucket, key).await?;
            respond_json(200, json!({ "ok": true, "deleted": key }))
        }

        _ => respond_json(404, json!({
            "error": "not found",
            "routes": [
                "GET /         list all objects",
                "GET /:key     download object",
                "PUT /:key     upload object (body = content, ?ct=mime/type)",
                "DELETE /:key  delete object",
            ]
        })),
    }
}
