use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use base64::Engine;
use regex::Regex;
use url::Url;

use crate::store::AppState;

#[derive(Clone)]
struct ProxyState {
    app: Arc<AppState>,
    token: String,
}

fn b64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

fn b64_decode(data: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data)
        .map_err(|e| e.to_string())
}

fn playlist_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"URI="([^"]+)""#).unwrap())
}

/// Build a URL that the local proxy will resolve on behalf of the webview.
pub fn make_media_url(
    base: &str,
    target: &str,
    headers: &HashMap<String, String>,
) -> String {
    let headers_json = serde_json::to_string(headers).unwrap_or_else(|_| "{}".into());
    format!(
        "{base}/media?u={}&h={}",
        b64_encode(target.as_bytes()),
        b64_encode(headers_json.as_bytes())
    )
}

#[tauri::command]
pub fn media_proxy_url(
    state: tauri::State<'_, Arc<AppState>>,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let base = state.proxy_base.read().unwrap().clone();
    if base.is_empty() {
        return Err("媒体代理尚未启动".into());
    }
    Ok(make_media_url(&base, &url, &headers.unwrap_or_default()))
}

#[tauri::command]
pub fn proxy_base(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    let base = state.proxy_base.read().unwrap().clone();
    if base.is_empty() {
        Err("媒体代理尚未启动".into())
    } else {
        Ok(base)
    }
}

pub async fn start_proxy(app: Arc<AppState>) -> Result<String, String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let base = format!("http://127.0.0.1:{port}/{token}");
    *app.proxy_base.write().unwrap() = base.clone();

    let state = ProxyState {
        app,
        token: token.clone(),
    };
    let router = Router::new()
        .route(
            "/{token}/media",
            get(handle_media).options(handle_options),
        )
        .with_state(state);

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(base)
}

async fn handle_options() -> Response {
    cors(StatusCode::NO_CONTENT.into_response())
}

fn cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("*"),
    );
    headers.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("*"),
    );
    response
}

#[derive(serde::Deserialize)]
struct MediaQuery {
    u: String,
    #[serde(default)]
    h: Option<String>,
}

async fn handle_media(
    State(state): State<ProxyState>,
    Path(token): Path<String>,
    Query(query): Query<MediaQuery>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if token != state.token {
        return cors(StatusCode::NOT_FOUND.into_response());
    }
    match proxy_media(&state, query, method, headers).await {
        Ok(response) => cors(response),
        Err(err) => {
            let mut response = (StatusCode::BAD_GATEWAY, err).into_response();
            response.headers_mut().insert(
                "content-type",
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            cors(response)
        }
    }
}

async fn proxy_media(
    state: &ProxyState,
    query: MediaQuery,
    method: Method,
    incoming: HeaderMap,
) -> Result<Response, String> {
    let target = String::from_utf8(b64_decode(&query.u)?).map_err(|e| e.to_string())?;
    let headers: HashMap<String, String> = match &query.h {
        Some(h) if !h.is_empty() => {
            let raw = String::from_utf8(b64_decode(h)?).map_err(|e| e.to_string())?;
            serde_json::from_str(&raw).unwrap_or_default()
        }
        _ => HashMap::new(),
    };

    let client = state.app.media_client();
    let req_method = if method == Method::HEAD {
        reqwest::Method::HEAD
    } else {
        reqwest::Method::GET
    };
    let mut request = client.request(req_method, &target);
    for (key, value) in &headers {
        request = request.header(key, value);
    }
    for name in ["range", "if-range", "accept", "accept-language"] {
        if let Some(value) = incoming.get(name) {
            request = request.header(name, value);
        }
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let looks_playlist = target.contains(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("x-mpegurl")
        || content_type.contains("vnd.apple");

    if looks_playlist && status.is_success() && method != Method::HEAD {
        let text = response.text().await.map_err(|e| e.to_string())?;
        if text.trim_start().starts_with("#EXTM3U") {
            let base = state.app.proxy_base.read().unwrap().clone();
            let rewritten = rewrite_playlist(&text, &final_url, &base, &headers);
            return Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/vnd.apple.mpegurl")
                .header("cache-control", "no-cache")
                .body(Body::from(rewritten))
                .map_err(|e| e.to_string());
        }
        // Not actually a playlist, return as text.
        return Response::builder()
            .status(status.as_u16())
            .header(
                "content-type",
                HeaderValue::from_str(&content_type)
                    .unwrap_or(HeaderValue::from_static("text/plain")),
            )
            .body(Body::from(text))
            .map_err(|e| e.to_string());
    }

    let mut builder = Response::builder().status(status.as_u16());
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "last-modified",
        "etag",
        "content-disposition",
    ] {
        if let Some(value) = response.headers().get(name) {
            builder = builder.header(name, value);
        }
    }

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(response.bytes_stream())
    };
    builder.body(body).map_err(|e| e.to_string())
}

fn rewrite_playlist(
    text: &str,
    playlist_url: &Url,
    base: &str,
    headers: &HashMap<String, String>,
) -> String {
    let mut out = String::with_capacity(text.len() + 1024);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            let rewritten = playlist_url_regex()
                .replace_all(line, |caps: &regex::Captures| {
                    let uri = &caps[1];
                    match playlist_url.join(uri) {
                        Ok(abs) => format!("URI=\"{}\"", make_media_url(base, abs.as_str(), headers)),
                        Err(_) => format!("URI=\"{uri}\""),
                    }
                })
                .to_string();
            out.push_str(&rewritten);
        } else if trimmed.is_empty() {
            out.push_str(line);
        } else {
            match playlist_url.join(trimmed) {
                Ok(abs) => out.push_str(&make_media_url(base, abs.as_str(), headers)),
                Err(_) => out.push_str(line),
            }
        }
        out.push('\n');
    }
    out
}
