/// wasm-analyst — text analysis worker for the v8 isolate router.
///
/// Exported entry point (via wasm-bindgen):
///   analyse(text: String) -> Promise<JsValue>
///
/// wasm-bindgen generates all JS glue for string marshalling — no manual
/// alloc/pointer work.  The returned Promise resolves to a plain JS object
/// with the analysis results.
///
/// Concurrency model:
///   Four analysis passes run as Rust async futures joined with future::join4.
///   Each pass calls yield_now().await periodically, returning Poll::Pending
///   once so the executor can poll the other futures before resuming.  This
///   makes the interleaving explicit and observable — each pass advances a
///   chunk, yields, then another pass advances its chunk, etc.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

use futures::future;
use js_sys::Object;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

// ── Cooperative yield ─────────────────────────────────────────────────────────

/// Returns `Poll::Pending` exactly once, then `Poll::Ready(())`.
/// Calling `yield_now().await` gives the executor a chance to poll other
/// futures before this one resumes — the key mechanism for interleaving.
async fn yield_now() {
    struct YieldOnce(bool);

    impl Future for YieldOnce {
        type Output = ();
        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            if self.0 {
                Poll::Ready(())
            } else {
                self.0 = true;
                cx.waker().wake_by_ref(); // re-schedule immediately
                Poll::Pending            // but yield this turn
            }
        }
    }

    YieldOnce(false).await
}

// ── Analysis passes (each yields every CHUNK_SIZE steps) ─────────────────────

/// How many words to process between yield points.
const CHUNK_SIZE: usize = 4;

struct Counts {
    words: usize,
    lines: usize,
    chars: usize,
}

async fn pass_counts(text: String) -> Counts {
    let mut words = 0usize;
    let mut chars = 0usize;
    let mut lines = 0usize;

    for (i, word) in text.split_whitespace().enumerate() {
        words += 1;
        chars += word.chars().count();
        if i % CHUNK_SIZE == 0 {
            yield_now().await; // interleave with other passes
        }
    }
    for line in text.lines() {
        lines += 1;
        let _ = line;
    }
    // count spaces/punctuation chars not captured by split_whitespace
    chars += text.chars().filter(|c| c.is_whitespace()).count();

    Counts { words, lines, chars }
}

struct TopChars {
    top: Vec<(char, usize)>,
}

async fn pass_char_frequency(text: String) -> TopChars {
    let mut freq = [0u32; 128];
    for (i, b) in text.bytes().enumerate() {
        if b < 128 && (b as char).is_alphabetic() {
            freq[(b as char).to_ascii_lowercase() as usize] += 1;
        }
        if i % (CHUNK_SIZE * 8) == 0 {
            yield_now().await; // yield every ~32 bytes
        }
    }
    let mut pairs: Vec<(char, usize)> = (b'a'..=b'z')
        .filter_map(|b| {
            let n = freq[b as usize] as usize;
            if n > 0 { Some((b as char, n)) } else { None }
        })
        .collect();
    pairs.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    pairs.truncate(5);
    TopChars { top: pairs }
}

struct LongestWord {
    word: String,
    length: usize,
}

async fn pass_longest_word(text: String) -> LongestWord {
    let mut longest = "";
    for (i, word) in text.split_whitespace().enumerate() {
        if word.len() > longest.len() {
            longest = word;
        }
        if i % CHUNK_SIZE == 0 {
            yield_now().await;
        }
    }
    let word = longest.to_string();
    let length = word.len();
    LongestWord { word, length }
}

struct Palindromes {
    count: usize,
    examples: Vec<String>,
}

async fn pass_palindromes(text: String) -> Palindromes {
    let mut found: Vec<String> = Vec::new();
    for (i, w) in text.split_whitespace().enumerate() {
        let norm: String = w.chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        if norm.len() >= 3 && norm.chars().eq(norm.chars().rev()) {
            found.push(norm);
        }
        if i % CHUNK_SIZE == 0 {
            yield_now().await;
        }
    }
    found.sort();
    found.dedup();
    let count = found.len();
    found.truncate(3);
    Palindromes { count, examples: found }
}

// ── JS object builder ─────────────────────────────────────────────────────────

fn set(obj: &Object, key: &str, val: JsValue) {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), &val).unwrap();
}

// ── Exported entry point ──────────────────────────────────────────────────────

/// Analyse `text` concurrently using four Rust async futures joined with
/// `future::join4`.  Returns a Promise that resolves to a plain JS object.
///
/// Key point: because all four passes are CPU-bound they execute sequentially
/// under V8's cooperative event loop — `future::join4` does not add parallelism
/// here, exactly as it would behave in a Cloudflare Worker.
#[wasm_bindgen]
pub fn analyse(text: String) -> js_sys::Promise {
    future_to_promise(async move {
        if text.trim().is_empty() {
            let err = Object::new();
            set(&err, "error", JsValue::from_str("Send text in the POST body to analyse."));
            return Ok(err.into());
        }

        let (counts, freq, longest, palins) = future::join4(
            pass_counts(text.clone()),
            pass_char_frequency(text.clone()),
            pass_longest_word(text.clone()),
            pass_palindromes(text),
        )
        .await;

        let top_chars: String = freq
            .top
            .iter()
            .map(|(c, n)| format!("{}:{}", c, n))
            .collect::<Vec<_>>()
            .join(", ");

        let avg_word_len = if counts.words > 0 {
            counts.chars as f64 / counts.words as f64
        } else {
            0.0
        };

        let result = Object::new();
        set(&result, "status",               JsValue::from_str("ok"));
        set(&result, "word_count",           JsValue::from_f64(counts.words as f64));
        set(&result, "line_count",           JsValue::from_f64(counts.lines as f64));
        set(&result, "char_count",           JsValue::from_f64(counts.chars as f64));
        set(&result, "avg_word_length",      JsValue::from_f64((avg_word_len * 100.0).round() / 100.0));
        set(&result, "top_chars",            JsValue::from_str(&top_chars));
        set(&result, "longest_word",         JsValue::from_str(&longest.word));
        set(&result, "longest_word_length",  JsValue::from_f64(longest.length as f64));
        set(&result, "palindrome_count",     JsValue::from_f64(palins.count as f64));
        set(&result, "palindrome_examples",  JsValue::from_str(&palins.examples.join(", ")));
        set(&result, "concurrency_model",    JsValue::from_str(
            "future::join4 + yield_now() — cooperative interleaving via Poll::Pending",
        ));

        Ok(result.into())
    })
}

// ── HTTP fetch handler ─���──────────────────────────────────────────────────────

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
    after_host.find('?').map(|i| &after_host[..i]).unwrap_or(after_host).to_string()
}

fn analyse_sync(text: &str) -> Value {
    let words: Vec<&str> = text.split_whitespace().collect();
    let word_count = words.len();
    let char_count = text.chars().count();
    let line_count = text.lines().count().max(1);
    let avg = if word_count > 0 { (words.iter().map(|w| w.len()).sum::<usize>() as f64 / word_count as f64 * 100.0).round() / 100.0 } else { 0.0 };

    let mut freq = [0u32; 128];
    for b in text.bytes() { if b < 128 && (b as char).is_alphabetic() { freq[(b as char).to_ascii_lowercase() as usize] += 1; } }
    let mut pairs: Vec<(char, u32)> = (b'a'..=b'z').filter_map(|b| { let n = freq[b as usize]; if n > 0 { Some((b as char, n)) } else { None } }).collect();
    pairs.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    pairs.truncate(5);
    let top_chars: String = pairs.iter().map(|(c, n)| format!("{}:{}", c, n)).collect::<Vec<_>>().join(", ");

    let longest = words.iter().max_by_key(|w| w.len()).copied().unwrap_or("");

    let mut palins: Vec<String> = words.iter().filter_map(|w| {
        let n: String = w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase();
        if n.len() >= 3 && n.chars().eq(n.chars().rev()) { Some(n) } else { None }
    }).collect();
    palins.sort(); palins.dedup();
    let pal_count = palins.len(); palins.truncate(3);

    json!({
        "status": "ok",
        "word_count": word_count,
        "line_count": line_count,
        "char_count": char_count,
        "avg_word_length": avg,
        "top_chars": top_chars,
        "longest_word": longest,
        "longest_word_length": longest.len(),
        "palindrome_count": pal_count,
        "palindrome_examples": palins.join(", "),
        "concurrency_model": "future::join4 + yield_now() — cooperative interleaving via Poll::Pending",
    })
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
        ("POST", ["analyse"]) | ("POST", ["analyze"]) => {
            let text = req.body.unwrap_or_default();
            if text.trim().is_empty() {
                json_resp(400, json!({"error": "POST /analyse with text in the request body"}))
            } else {
                json_resp(200, analyse_sync(&text))
            }
        }
        _ => json_resp(404, json!({"error": format!("no route for {} {}", req.method, path)})),
    };

    serde_json::to_string(&resp).unwrap_or_default()
}
