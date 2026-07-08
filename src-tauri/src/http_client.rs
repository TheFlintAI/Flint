use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::error::Error as StdError;
use std::io::Read;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Window;

/// Format an error with its full source chain (for better diagnostics).
fn format_error_chain(mut err: &dyn StdError) -> String {
    let mut out = err.to_string();
    while let Some(source) = err.source() {
        out.push_str(": ");
        out.push_str(&source.to_string());
        err = source;
    }
    out
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequestArgs {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub body: Option<String>,
    pub allow_insecure_tls: Option<bool>,
    pub request_id: Option<String>,
    /// Optional response body charset override (e.g. "gbk").
    #[serde(alias = "responseEncoding")]
    pub response_encoding: Option<String>,
    #[serde(alias = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

pub fn request(request: ApiRequestArgs) -> Result<Value, String> {
    let method = request.method.as_deref().unwrap_or("GET");
    let started = Instant::now();
    tracing::debug!("[http] {} {}", method, request.url);
    let client = build_http_client(request.allow_insecure_tls.unwrap_or(false))?;
    let mut builder = client.request(
        method
            .parse()
            .map_err(|error| format!("invalid HTTP method: {error}"))?,
        &request.url,
    );
    for (key, value) in request.headers.unwrap_or_default() {
        if is_forwardable_header(&key) {
            builder = builder.header(key, value);
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms.max(1)));
    }
    let response = builder.send().map_err(|error| {
        let msg = format_error_chain(&error);
        tracing::warn!("[http] {} {} failed: {msg}", method, request.url);
        msg
    })?;
    let status = response.status().as_u16();
    let elapsed_ms = started.elapsed().as_millis();
    tracing::debug!("[http] {} {} -> {status} ({elapsed_ms}ms)", method, request.url);
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (key.to_string(), value.to_string()))
        })
        .collect::<BTreeMap<_, _>>();
    let body = if let Some(ref encoding) = request.response_encoding {
        // If Content-Type explicitly declares a charset, prefer it over
        // the plugin's encoding hint. Chinese web APIs occasionally switch
        // encodings (e.g. Tencent smartbox moved from GBK to UTF-8); blindly
        // applying a stale responseEncoding would corrupt the text.
        let ct = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if ct.to_ascii_lowercase().contains("charset=") {
            response.text().map_err(|error| format_error_chain(&error))?
        } else {
            response.text_with_charset(encoding).map_err(|error| format_error_chain(&error))?
        }
    } else {
        response.text().map_err(|error| format_error_chain(&error))?
    };
    Ok(json!({
        "success": true,
        "statusCode": status,
        "headers": headers,
        "body": body
    }))
}

pub fn spawn_http_stream<F>(window: Window, request: ApiRequestArgs, emit: F)
where
    F: Fn(&Window, &str, Value) -> Result<(), String> + Send + Copy + 'static,
{
    thread::spawn(move || {
        let request_id = request
            .request_id
            .clone()
            .unwrap_or_else(|| format!("api-stream-{}", started_millis()));
        tracing::debug!("[http:stream] {} {} (id={request_id})", request.method.as_deref().unwrap_or("POST"), request.url);
        let result = run_http_stream(&window, &request_id, request, emit);
        if let Err(error) = result {
            tracing::warn!("[http:stream] {request_id} failed: {error}");
            let _ = emit(
                &window,
                "api:stream-error",
                json!({ "requestId": request_id, "error": error }),
            );
        }
    });
}

fn run_http_stream<F>(
    window: &Window,
    request_id: &str,
    request: ApiRequestArgs,
    emit: F,
) -> Result<(), String>
where
    F: Fn(&Window, &str, Value) -> Result<(), String>,
{
    let client = build_http_client(request.allow_insecure_tls.unwrap_or(false))?;
    let mut builder = client.request(
        request
            .method
            .as_deref()
            .unwrap_or("POST")
            .parse()
            .map_err(|error| format!("invalid HTTP method: {error}"))?,
        &request.url,
    );
    for (key, value) in request.headers.unwrap_or_default() {
        if is_forwardable_header(&key) {
            builder = builder.header(key, value);
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = builder.send().map_err(|error| format_error_chain(&error))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        emit(
            window,
            "api:stream-error",
            json!({ "requestId": request_id, "statusCode": status, "error": body }),
        )?;
        return Ok(());
    }
    let mut buffer = [0u8; 8192];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format_error_chain(&error))?;
        if read == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
        emit(
            window,
            "api:stream-chunk",
            json!({ "requestId": request_id, "data": chunk }),
        )?;
    }
    emit(window, "api:stream-end", json!({ "requestId": request_id }))?;
    Ok(())
}

/// Build a blocking HTTP client with the global configuration shared by
/// every outbound request in the app (AI providers, plugins, web search,
/// image downloads, etc.).
///
/// ## Proxy detection
///
/// Enabled via the `system-proxy` Cargo feature. reqwest then honours:
///   - `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables
///   - Windows proxy settings (Internet Options → registry)
///   - macOS SystemConfiguration framework
///
/// ## TLS backend
///
/// reqwest 0.13 defaults `default-tls` to **rustls** (pure Rust, no system
/// dependency). The `aws-lc-rs` crypto provider is used. rustls is stricter
/// than Schannel / OpenSSL about protocol conformance — some servers that
/// omit the TLS `close_notify` alert (common with Chinese CDNs) will trigger
/// an "unexpected EOF" error. When that happens the caller can retry with
/// `allow_insecure_tls` to skip certificate verification (the EOF is *not* a
/// cert issue, but the flag serves as a general "lenient TLS" escape hatch).
pub(crate) fn build_http_client(
    allow_insecure_tls: bool,
) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(allow_insecure_tls)
        .build()
        .map_err(|error| format_error_chain(&error))
}

// ── Helpers ──────────────────────────────────────────────────────────

fn is_forwardable_header(key: &str) -> bool {
    !matches!(
        key.to_ascii_lowercase().as_str(),
        "connection"
            | "content-length"
            | "expect"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn started_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
