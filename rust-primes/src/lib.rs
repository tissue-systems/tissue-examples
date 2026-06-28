use futures::future;
use js_sys::Promise;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

static HTML: &str = include_str!("page.html");

// ── HTTP fetch handler ────────────────────────────────────────────────────────

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
    after_host.find('?').map(|i| &after_host[..i]).unwrap_or(after_host).to_string()
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

        ("POST", ["count"]) => {
            let body: Value = serde_json::from_str(&req.body.unwrap_or_default()).unwrap_or_default();
            let start = body["start"].as_u64().unwrap_or(2) as u32;
            let end   = body["end"].as_u64().unwrap_or(100_000) as u32;
            if end <= start { return serde_json::to_string(&json_resp(400, json!({"error":"end must be > start"}))).unwrap_or_default(); }
            if end - start > 5_000_000 { return serde_json::to_string(&json_resp(400, json!({"error":"range too large — max 5,000,000"}))).unwrap_or_default(); }
            let t0 = js_sys::Date::now();
            let count = count_primes_sync(start, end);
            let ms = (js_sys::Date::now() - t0).round() as u64;
            json_resp(200, json!({"start": start, "end": end, "count": count, "duration_ms": ms}))
        }

        ("POST", ["joined"]) => {
            let body: Value = serde_json::from_str(&req.body.unwrap_or_default()).unwrap_or_default();
            let s1 = body["start1"].as_u64().unwrap_or(2) as u32;
            let e1 = body["end1"].as_u64().unwrap_or(50_000) as u32;
            let s2 = body["start2"].as_u64().unwrap_or(50_000) as u32;
            let e2 = body["end2"].as_u64().unwrap_or(100_000) as u32;
            if (e1.saturating_sub(s1)) + (e2.saturating_sub(s2)) > 5_000_000 { return serde_json::to_string(&json_resp(400, json!({"error":"combined range too large — max 5,000,000 total"}))).unwrap_or_default(); }
            let t0 = js_sys::Date::now();
            let c1 = count_primes_sync(s1, e1);
            let c2 = count_primes_sync(s2, e2);
            let ms = (js_sys::Date::now() - t0).round() as u64;
            json_resp(200, json!({"count1": c1, "count2": c2, "total": c1+c2, "duration_ms": ms}))
        }

        _ => json_resp(404, json!({"error": format!("no route for {} {}", req.method, path)})),
    };

    serde_json::to_string(&resp).unwrap_or_default()
}

/// Synchronous prime counting over [start, end).
/// This is the CPU-bound kernel.
fn count_primes_sync(start: u32, end: u32) -> u32 {
    (start..end).filter(|&n| is_prime(n)).count() as u32
}

fn is_prime(n: u32) -> bool {
    if n < 2 {
        return false;
    }
    if n == 2 {
        return true;
    }
    if n % 2 == 0 {
        return false;
    }
    let mut i = 3u32;
    while i * i <= n {
        if n % i == 0 {
            return false;
        }
        i += 2;
    }
    true
}

/// Returns a JS Promise<number> that resolves to the count of primes in [start, end).
///
/// Because this is a CPU-bound task the async wrapper does NOT add parallelism —
/// the Rust Future state machine maps to a JS Promise, but the computation still
/// runs synchronously on the JS thread before the promise resolves.
///
/// Two of these joined with Promise.all() will run sequentially under V8's
/// cooperative event loop, not in parallel.
#[wasm_bindgen]
pub fn count_primes_async(start: u32, end: u32) -> Promise {
    future_to_promise(async move {
        let count = count_primes_sync(start, end);
        Ok(JsValue::from(count))
    })
}

/// Joins two ranges using futures::join! — both futures are polled cooperatively
/// by the same single-threaded executor.  The result is a Promise<[u32, u32]>.
///
/// Key takeaway: futures::join! on CPU-bound work is NOT parallel.
/// range_1 will fully complete before range_2 starts because neither future
/// ever yields back to the executor mid-computation.
#[wasm_bindgen]
pub fn count_primes_joined(
    start1: u32,
    end1: u32,
    start2: u32,
    end2: u32,
) -> Promise {
    future_to_promise(async move {
        let range1 = async move { count_primes_sync(start1, end1) };
        let range2 = async move { count_primes_sync(start2, end2) };

        let (c1, c2) = future::join(range1, range2).await;

        let arr = js_sys::Array::new();
        arr.push(&JsValue::from(c1));
        arr.push(&JsValue::from(c2));
        Ok(arr.into())
    })
}
