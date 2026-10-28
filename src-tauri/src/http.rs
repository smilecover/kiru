use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use reqwest::header::{HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::store::{build_client, build_media_client, AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpOptions {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub query: Option<HashMap<String, String>>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_base64: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// "text" (default) or "base64"
    #[serde(default)]
    pub response_type: Option<String>,
    #[serde(default)]
    pub redirect: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct HttpResult {
    pub status: u16,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub base64: Option<String>,
}

#[tauri::command]
pub async fn http_request(
    state: tauri::State<'_, Arc<AppState>>,
    options: HttpOptions,
) -> Result<HttpResult, String> {
    let client = state.client();
    let method = options
        .method
        .clone()
        .unwrap_or_else(|| "GET".to_string())
        .to_uppercase();
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| format!("请求方法错误: {e}"))?;

    let mut url = Url::parse(&options.url).map_err(|e| format!("URL 错误: {e}"))?;
    if let Some(query) = &options.query {
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in query {
                pairs.append_pair(k, v);
            }
        }
    }

    let mut request = client.request(method, url);
    if let Some(ms) = options.timeout_ms {
        request = request.timeout(std::time::Duration::from_millis(ms));
    }

    for (key, value) in &options.headers {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("请求头 {key} 无效: {e}"))?;
        let val = HeaderValue::from_str(value).map_err(|e| format!("请求头 {key} 的值无效: {e}"))?;
        request = request.header(name, val);
    }

    if let Some(b64) = &options.body_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("请求体解码失败: {e}"))?;
        request = request.body(bytes);
    } else if let Some(body) = &options.body {
        request = request.body(body.clone());
    }

    let response = request.send().await.map_err(|e| {
        let mut msg = e.to_string();
        if e.is_timeout() {
            msg = "请求超时".to_string();
        } else if e.is_connect() {
            msg = format!("连接失败: {msg}");
        }
        msg
    })?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        headers
            .entry(key.as_str().to_string())
            .and_modify(|v: &mut String| {
                v.push_str("; ");
                v.push_str(&String::from_utf8_lossy(value.as_bytes()));
            })
            .or_insert_with(|| String::from_utf8_lossy(value.as_bytes()).to_string());
    }

    let binary = options.response_type.as_deref() == Some("base64");
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    state.save_cookies();

    if binary {
        Ok(HttpResult {
            status,
            url: final_url,
            headers,
            body: String::new(),
            base64: Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
        })
    } else {
        Ok(HttpResult {
            status,
            url: final_url,
            headers,
            body: String::from_utf8_lossy(&bytes).to_string(),
            base64: None,
        })
    }
}

#[tauri::command]
pub fn net_config(
    state: tauri::State<'_, Arc<AppState>>,
    proxy_type: String,
    proxy: String,
) -> Result<(), String> {
    let client = build_client(state.cookie_store.clone(), &proxy_type, &proxy)?;
    let media_client = build_media_client(state.cookie_store.clone(), &proxy_type, &proxy)?;
    *state.client.write().unwrap() = client;
    *state.media_client.write().unwrap() = media_client;
    *state.proxy_type.write().unwrap() = proxy_type;
    *state.proxy_addr.write().unwrap() = proxy;
    Ok(())
}

#[tauri::command]
pub fn cookies_get(state: tauri::State<'_, Arc<AppState>>, url: String) -> Result<String, String> {
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    let store = state.cookie_store.lock().map_err(|e| e.to_string())?;
    let value = store
        .get_request_values(&url)
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ");
    Ok(value)
}

#[tauri::command]
pub fn cookies_set(
    state: tauri::State<'_, Arc<AppState>>,
    url: String,
    cookies: String,
) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    {
        let mut store = state.cookie_store.lock().map_err(|e| e.to_string())?;
        for segment in cookies.split(';') {
            let segment = segment.trim();
            if segment.is_empty() {
                continue;
            }
            let cookie = cookie::Cookie::parse(segment.to_string())
                .map_err(|e| format!("Cookie 解析失败: {e}"))?;
            let _ = store.insert_raw(&cookie, &url);
        }
    }
    state.save_cookies();
    Ok(())
}

#[tauri::command]
pub fn cookies_clear(
    state: tauri::State<'_, Arc<AppState>>,
    url: String,
) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    {
        let mut store = state.cookie_store.lock().map_err(|e| e.to_string())?;
        let keys: Vec<(String, String, String)> = store
            .matches(&url)
            .iter()
            .map(|cookie| {
                (
                    cookie.domain().unwrap_or_default().to_string(),
                    cookie.path().unwrap_or("/").to_string(),
                    cookie.name().to_string(),
                )
            })
            .collect();
        for (domain, path, name) in keys {
            store.remove(&domain, &path, &name);
        }
    }
    state.save_cookies();
    Ok(())
}
