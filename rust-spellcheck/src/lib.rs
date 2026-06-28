use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use wasm_bindgen::prelude::wasm_bindgen;

const DICTIONARY: &str = include_str!("dictionary.txt");

static WORDS: OnceLock<Vec<&'static str>> = OnceLock::new();

fn get_words() -> &'static [&'static str] {
    WORDS.get_or_init(|| {
        DICTIONARY.lines().map(str::trim).filter(|l| !l.is_empty()).collect()
    })
}

fn levenshtein(a: &[char], b: &[char]) -> u32 {
    let (m, n) = (a.len(), b.len());
    // Space-efficient: two rows only
    let mut prev: Vec<u32> = (0..=(n as u32)).collect();
    let mut curr = vec![0u32; n + 1];
    for i in 1..=m {
        curr[0] = i as u32;
        for j in 1..=n {
            curr[j] = if a[i - 1] == b[j - 1] {
                prev[j - 1]
            } else {
                1 + prev[j - 1].min(prev[j]).min(curr[j - 1])
            };
        }
        prev.clone_from(&curr);
    }
    prev[n]
}

#[derive(Serialize)]
struct Suggestion {
    word: String,
    distance: u32,
}

#[derive(Serialize)]
struct CheckResult {
    query: String,
    exact: bool,
    suggestions: Vec<Suggestion>,
    checked: usize,
}

#[derive(Deserialize)]
struct CheckRequest {
    word: String,
}

#[derive(Deserialize)]
struct IncomingRequest {
    method: String,
    url: String,
    body: Option<String>,
}

#[derive(Serialize)]
struct WasmResponse {
    status: u16,
    #[serde(rename = "headers")]
    hdr: std::collections::HashMap<String, String>,
    body: String,
}

fn response(status: u16, content_type: &str, body: String) -> WasmResponse {
    let mut hdr = std::collections::HashMap::new();
    hdr.insert("content-type".into(), content_type.into());
    WasmResponse { status, hdr, body }
}

fn check_word(query: &str) -> CheckResult {
    let q_chars: Vec<char> = query.trim().to_lowercase().chars().collect();
    let q = q_chars.iter().collect::<String>();

    let words = get_words();
    let checked = words.len();

    let mut scored: Vec<(&str, u32)> = words.iter()
        .map(|&w| {
            let wc: Vec<char> = w.chars().collect();
            (w, levenshtein(&q_chars, &wc))
        })
        .collect();

    scored.sort_unstable_by_key(|&(_, d)| d);

    let exact = scored.first().map(|&(_, d)| d == 0).unwrap_or(false);

    let suggestions = scored.iter()
        .take(8)
        .map(|&(w, d)| Suggestion { word: w.to_string(), distance: d })
        .collect();

    CheckResult { query: q, exact, suggestions, checked }
}

static HTML: &str = include_str!("page.html");

#[wasm_bindgen]
pub fn fetch(req_json: String) -> String {
    let req: IncomingRequest = match serde_json::from_str(&req_json) {
        Ok(r) => r,
        Err(e) => {
            let r = response(400, "text/plain", format!("bad request: {e}"));
            return serde_json::to_string(&r).unwrap_or_default();
        }
    };

    let url = req.url.as_str();
    let method = req.method.as_str();

    let resp = if url.contains("/check") && method == "POST" {
        let body = req.body.unwrap_or_default();
        match serde_json::from_str::<CheckRequest>(&body) {
            Ok(cr) if !cr.word.trim().is_empty() => {
                let result = check_word(cr.word.trim());
                match serde_json::to_string(&result) {
                    Ok(json) => response(200, "application/json", json),
                    Err(_) => response(500, "text/plain", "serialization error".into()),
                }
            }
            _ => response(400, "application/json", r#"{"error":"missing word"}"#.into()),
        }
    } else {
        response(200, "text/html; charset=utf-8", HTML.to_string())
    };

    serde_json::to_string(&resp).unwrap_or_default()
}
