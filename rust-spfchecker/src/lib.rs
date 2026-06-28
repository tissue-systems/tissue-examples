use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

// ── Wire types ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct IncomingRequest {
    method: String,
    url: String,
    body: Option<String>,
}

#[derive(Serialize)]
struct WasmResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

fn response(status: u16, content_type: &str, body: String) -> WasmResponse {
    let mut headers = std::collections::HashMap::new();
    headers.insert("content-type".into(), content_type.into());
    WasmResponse { status, headers, body }
}

// ── SPF analysis types ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AnalyzeRequest {
    domain: String,
    /// All TXT records collected by the browser, keyed by domain name.
    /// Each entry: { name: "domain.com", records: ["v=spf1 ...", "..."] }
    dns_records: Vec<DnsEntry>,
}

#[derive(Deserialize)]
struct DnsEntry {
    name: String,
    records: Vec<String>,
}

#[derive(Serialize, Clone)]
struct Violation {
    code: String,
    severity: String, // "error" | "warning" | "info"
    message: String,
}

#[derive(Serialize)]
struct MechanismDetail {
    raw: String,
    kind: String,
    qualifier: String,
    counts_as_lookup: bool,
}

#[derive(Serialize)]
struct DomainAnalysis {
    domain: String,
    spf_record: Option<String>,
    mechanisms: Vec<MechanismDetail>,
    lookup_count: u32,
}

#[derive(Serialize)]
struct AnalysisResult {
    domain: String,
    spf_found: bool,
    spf_record: Option<String>,
    total_dns_lookups: u32,
    domains_checked: Vec<DomainAnalysis>,
    violations: Vec<Violation>,
    valid: bool,
    summary: String,
}

// ── SPF parser ────────────────────────────────────────────────────────────────

fn qualifier_str(ch: char) -> &'static str {
    match ch {
        '+' => "pass",
        '-' => "fail",
        '~' => "softfail",
        '?' => "neutral",
        _ => "pass",
    }
}

fn mechanism_kind(token: &str) -> (&str, bool) {
    // Returns (kind, counts_as_lookup)
    let t = token.trim_start_matches(['+', '-', '~', '?']);
    let lower = t.to_lowercase();
    if lower == "all" { return ("all", false); }
    if lower.starts_with("ip4:") || lower.starts_with("ip4") { return ("ip4", false); }
    if lower.starts_with("ip6:") || lower.starts_with("ip6") { return ("ip6", false); }
    if lower.starts_with("include:") { return ("include", true); }
    if lower.starts_with("a:") || lower == "a" { return ("a", true); }
    if lower.starts_with("mx:") || lower == "mx" { return ("mx", true); }
    if lower.starts_with("ptr:") || lower == "ptr" { return ("ptr", true); }
    if lower.starts_with("exists:") { return ("exists", true); }
    if lower.starts_with("redirect=") { return ("redirect", true); }
    if lower.starts_with("exp=") { return ("exp", false); }
    ("unknown", false)
}

fn find_spf(records: &[String]) -> Option<String> {
    let hits: Vec<&String> = records.iter()
        .filter(|r| r.trim().to_lowercase().starts_with("v=spf1"))
        .collect();
    if hits.is_empty() { return None; }
    Some(hits[0].clone())
}

fn analyze_domain(
    domain: &str,
    dns_map: &std::collections::HashMap<String, Vec<String>>,
    violations: &mut Vec<Violation>,
    total_lookups: &mut u32,
    seen: &mut Vec<String>,
) -> DomainAnalysis {
    if seen.contains(&domain.to_string()) {
        violations.push(Violation {
            code: "SPF_LOOP".into(),
            severity: "error".into(),
            message: format!("Circular include detected for '{domain}'"),
        });
        return DomainAnalysis {
            domain: domain.into(),
            spf_record: None,
            mechanisms: vec![],
            lookup_count: 0,
        };
    }
    seen.push(domain.to_string());

    let records = dns_map.get(domain).cloned().unwrap_or_default();

    // Check for multiple SPF records
    let spf_count = records.iter()
        .filter(|r| r.trim().to_lowercase().starts_with("v=spf1"))
        .count();
    if spf_count > 1 {
        violations.push(Violation {
            code: "MULTIPLE_SPF".into(),
            severity: "error".into(),
            message: format!("'{domain}' has {spf_count} SPF records — RFC 7208 requires exactly one"),
        });
    }

    let spf = find_spf(&records);
    if spf.is_none() {
        if !seen.is_empty() {
            violations.push(Violation {
                code: "NO_SPF".into(),
                severity: "warning".into(),
                message: format!("No SPF record found for '{domain}'"),
            });
        }
        return DomainAnalysis {
            domain: domain.into(),
            spf_record: None,
            mechanisms: vec![],
            lookup_count: 0,
        };
    }
    let spf_str = spf.unwrap();
    let tokens: Vec<&str> = spf_str.split_whitespace().collect();

    let mut mechanisms = vec![];
    let mut domain_lookups: u32 = 0;
    let mut has_all = false;
    let mut after_all = false;
    let mut redirect_domain: Option<String> = None;

    for (i, &token) in tokens.iter().enumerate() {
        if i == 0 { continue; } // skip v=spf1

        let lower = token.to_lowercase();
        let qual_ch = token.chars().next().unwrap_or('+');
        let qualifier = if "+-~?".contains(qual_ch) { qualifier_str(qual_ch) } else { "pass" }.to_string();
        let (kind, counts) = mechanism_kind(token);

        if after_all {
            violations.push(Violation {
                code: "MECHANISM_AFTER_ALL".into(),
                severity: "warning".into(),
                message: format!("Mechanism '{token}' appears after 'all' and will never be evaluated"),
            });
        }

        if kind == "all" { has_all = true; after_all = true; }

        if kind == "ptr" {
            violations.push(Violation {
                code: "PTR_DEPRECATED".into(),
                severity: "warning".into(),
                message: "The 'ptr' mechanism is deprecated (RFC 7208 §5.5) and should not be used".into(),
            });
        }

        if kind == "all" && qualifier == "pass" {
            violations.push(Violation {
                code: "PASS_ALL".into(),
                severity: "error".into(),
                message: "'+all' allows any server to send mail as your domain — this effectively disables SPF protection".into(),
            });
        }

        if counts {
            domain_lookups += 1;
            *total_lookups += 1;
        }

        // Check unknown/malformed mechanisms
        if kind == "unknown" {
            violations.push(Violation {
                code: "UNKNOWN_MECHANISM".into(),
                severity: "warning".into(),
                message: format!("Unrecognised mechanism or modifier: '{token}'"),
            });
        }

        if kind == "redirect" {
            if let Some(rdom) = lower.strip_prefix("redirect=") {
                redirect_domain = Some(rdom.to_string());
            }
        }

        // Check for missing value after colon/equals
        if (lower.starts_with("include:") || lower.starts_with("a:") || lower.starts_with("mx:"))
            && lower.split_once(':').map(|(_, v)| v.trim().is_empty()).unwrap_or(false)
        {
            violations.push(Violation {
                code: "EMPTY_MECHANISM_VALUE".into(),
                severity: "error".into(),
                message: format!("Mechanism '{token}' has no value after ':'"),
            });
        }

        mechanisms.push(MechanismDetail {
            raw: token.to_string(),
            kind: kind.to_string(),
            qualifier,
            counts_as_lookup: counts,
        });
    }

    if !has_all && redirect_domain.is_none() {
        violations.push(Violation {
            code: "MISSING_ALL".into(),
            severity: "warning".into(),
            message: format!("'{domain}' has no 'all' mechanism — unauthenticated mail result is undefined"),
        });
    }

    // Recurse into includes
    let include_domains: Vec<String> = mechanisms.iter()
        .filter(|m| m.kind == "include")
        .filter_map(|m| m.raw.split_once(':').map(|(_, v)| v.to_string()))
        .collect();

    for inc in &include_domains {
        if *total_lookups > 10 { break; }
        analyze_domain(inc, dns_map, violations, total_lookups, seen);
    }

    // Recurse into redirect
    if let Some(ref rdom) = redirect_domain {
        if *total_lookups <= 10 {
            analyze_domain(rdom, dns_map, violations, total_lookups, seen);
        }
    }

    DomainAnalysis {
        domain: domain.into(),
        spf_record: Some(spf_str),
        mechanisms,
        lookup_count: domain_lookups,
    }
}

fn run_analysis(req: AnalyzeRequest) -> AnalysisResult {
    let domain = req.domain.to_lowercase();

    // Build lookup map from supplied DNS records
    let mut dns_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for entry in &req.dns_records {
        dns_map.entry(entry.name.to_lowercase())
            .or_default()
            .extend(entry.records.clone());
    }

    let mut violations: Vec<Violation> = vec![];
    let mut total_lookups: u32 = 0;
    let mut seen: Vec<String> = vec![];
    let mut domains_checked: Vec<DomainAnalysis> = vec![];

    let root_records = dns_map.get(&domain).cloned().unwrap_or_default();
    let root_spf = find_spf(&root_records);
    let spf_found = root_spf.is_some();
    let spf_record = root_spf.clone();

    if spf_found {
        let analysis = analyze_domain(&domain, &dns_map, &mut violations, &mut total_lookups, &mut seen);
        domains_checked.push(analysis);
        // Collect subdomain analyses (from recursion we need to track them separately)
        for entry in &req.dns_records {
            let name = entry.name.to_lowercase();
            if name != domain && !seen.iter().skip(1).any(|s| s == &name) {
                if let Some(spf) = find_spf(&entry.records) {
                    domains_checked.push(DomainAnalysis {
                        domain: name.clone(),
                        spf_record: Some(spf),
                        mechanisms: vec![],
                        lookup_count: 0,
                    });
                }
            }
        }
    } else {
        violations.push(Violation {
            code: "NO_SPF_ROOT".into(),
            severity: "error".into(),
            message: format!("No SPF TXT record found for '{domain}'"),
        });
    }

    // RFC 7208 §4.6.4: max 10 DNS lookups
    if total_lookups > 10 {
        violations.push(Violation {
            code: "TOO_MANY_LOOKUPS".into(),
            severity: "error".into(),
            message: format!(
                "SPF requires {total_lookups} DNS lookups — RFC 7208 §4.6.4 limits this to 10. \
                 Receivers may return PermError and reject mail."
            ),
        });
    } else if total_lookups > 7 {
        violations.push(Violation {
            code: "NEAR_LOOKUP_LIMIT".into(),
            severity: "warning".into(),
            message: format!(
                "{total_lookups}/10 DNS lookups used — approaching the RFC 7208 limit. \
                 Adding more include: directives could push it over."
            ),
        });
    }

    let has_errors = violations.iter().any(|v| v.severity == "error");
    let valid = spf_found && !has_errors;

    let summary = if !spf_found {
        format!("No SPF record found for {domain}")
    } else if has_errors {
        let count = violations.iter().filter(|v| v.severity == "error").count();
        format!("{} error{} found — SPF will likely fail or be ignored by receivers",
            count, if count == 1 { "" } else { "s" })
    } else if violations.is_empty() {
        format!("SPF record for {domain} looks good ({total_lookups}/10 DNS lookups)")
    } else {
        let warns = violations.iter().filter(|v| v.severity == "warning").count();
        format!("SPF record is functional but has {} warning{}", warns, if warns == 1 { "" } else { "s" })
    };

    AnalysisResult {
        domain,
        spf_found,
        spf_record,
        total_dns_lookups: total_lookups,
        domains_checked,
        violations,
        valid,
        summary,
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

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

    let resp = if req.url.contains("/analyze") && req.method == "POST" {
        let body = req.body.unwrap_or_default();
        match serde_json::from_str::<AnalyzeRequest>(&body) {
            Ok(ar) if !ar.domain.trim().is_empty() => {
                let result = run_analysis(ar);
                match serde_json::to_string(&result) {
                    Ok(json) => response(200, "application/json", json),
                    Err(e) => response(500, "text/plain", format!("serialization error: {e}")),
                }
            }
            _ => response(400, "application/json", r#"{"error":"missing domain or dns_records"}"#.into()),
        }
    } else {
        response(200, "text/html; charset=utf-8", HTML.to_string())
    };

    serde_json::to_string(&resp).unwrap_or_default()
}
