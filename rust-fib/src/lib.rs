use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

static HTML: &str = include_str!("page.html");

#[derive(Deserialize)]
struct IncomingRequest {
    method: String,
    url: String,
    body: Option<String>,
}

#[derive(Serialize)]
struct WasmResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

fn html_resp(body: &str) -> WasmResponse {
    WasmResponse { status: 200, headers: [("content-type".into(), "text/html;charset=utf-8".into())].into(), body: body.into() }
}

fn json_resp(status: u16, body: Value) -> WasmResponse {
    WasmResponse { status, headers: [("content-type".into(), "application/json".into())].into(), body: body.to_string() }
}

fn url_path(url: &str) -> String {
    let s = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).unwrap_or(url);
    let after_host = s.find('/').map(|i| &s[i..]).unwrap_or("/");
    let path = after_host.find('?').map(|i| &after_host[..i]).unwrap_or(after_host);
    path.to_string()
}

fn fibonacci(n: i32) -> u64 {
    if n <= 1 { return n as u64; }
    let mut a = 0u64;
    let mut b = 1u64;
    for _ in 2..=n {
        let tmp = a + b;
        a = b;
        b = tmp;
    }
    b
}

#[wasm_bindgen]
pub fn fetch(req_json: String) -> String {
    let req: IncomingRequest = match serde_json::from_str(&req_json) {
        Ok(r) => r,
        Err(e) => return serde_json::to_string(&json_resp(400, json!({"error": e.to_string()}))).unwrap_or_default(),
    };

    let path = url_path(&req.url);
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    let resp = match (req.method.to_uppercase().as_str(), parts.as_slice()) {
        ("GET", []) => html_resp(HTML),
        ("POST", ["fib"]) => {
            let body_str = req.body.unwrap_or_default();
            let body: Value = serde_json::from_str(&body_str).unwrap_or_default();
            let n = body["n"].as_i64().unwrap_or(10) as i32;
            if n < 0 || n > 93 {
                json_resp(400, json!({"error": "n must be 0–93"}))
            } else {
                json_resp(200, json!({"n": n, "result": fibonacci(n).to_string()}))
            }
        }
        _ => json_resp(404, json!({"error": format!("no route for {} {}", req.method, path)})),
    };

    serde_json::to_string(&resp).unwrap_or_default()
}
