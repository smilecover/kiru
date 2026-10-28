use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use reqwest_cookie_store::CookieStoreMutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub cookie_store: Arc<CookieStoreMutex>,
    pub cookie_path: PathBuf,
    pub client: RwLock<reqwest::Client>,
    pub media_client: RwLock<reqwest::Client>,
    pub proxy_type: RwLock<String>,
    pub proxy_addr: RwLock<String>,
    pub bt_child: std::sync::Mutex<Option<std::process::Child>>,
    pub proxy_base: RwLock<String>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = data_dir(app)?;
        let cookie_path = dir.join("cookies.json");
        let store = if cookie_path.exists() {
            match fs::File::open(&cookie_path) {
                Ok(file) => reqwest_cookie_store::CookieStore::load_json(BufReader::new(file))
                    .unwrap_or_default(),
                Err(_) => reqwest_cookie_store::CookieStore::default(),
            }
        } else {
            reqwest_cookie_store::CookieStore::default()
        };
        let cookie_store = Arc::new(CookieStoreMutex::new(store));
        let client = build_client(cookie_store.clone(), "DIRECT", "")?;
        let media_client = build_media_client(cookie_store.clone(), "DIRECT", "")?;
        Ok(Self {
            cookie_store,
            cookie_path,
            client: RwLock::new(client),
            media_client: RwLock::new(media_client),
            proxy_type: RwLock::new("DIRECT".into()),
            proxy_addr: RwLock::new(String::new()),
            bt_child: std::sync::Mutex::new(None),
            proxy_base: RwLock::new(String::new()),
        })
    }

    pub fn client(&self) -> reqwest::Client {
        self.client.read().unwrap().clone()
    }

    pub fn media_client(&self) -> reqwest::Client {
        self.media_client.read().unwrap().clone()
    }

    pub fn save_cookies(&self) {
        let dir = self.cookie_path.parent().map(|p| p.to_path_buf());
        if let Some(dir) = dir {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.cookie_path.with_extension("json.tmp");
        let result = (|| -> Result<(), String> {
            let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut writer = std::io::BufWriter::new(file);
            let store = self.cookie_store.lock().map_err(|e| e.to_string())?;
            store.save_json(&mut writer).map_err(|e| e.to_string())?;
            drop(store);
            fs::rename(&tmp, &self.cookie_path).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
    }
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kiru");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn build_client_inner(
    cookie_store: Arc<CookieStoreMutex>,
    proxy_type: &str,
    proxy_addr: &str,
    timeout: Option<std::time::Duration>,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .cookie_provider(cookie_store)
        .redirect(reqwest::redirect::Policy::limited(12))
        .connect_timeout(std::time::Duration::from_secs(20))
        .pool_max_idle_per_host(16);
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }

    let kind = proxy_type.to_uppercase();
    if kind != "DIRECT" && !proxy_addr.trim().is_empty() {
        let addr = proxy_addr.trim();
        let url = if kind == "SOCKS5" {
            format!("socks5://{addr}")
        } else if kind == "SOCKS4" {
            format!("socks4://{addr}")
        } else if addr.contains("://") {
            addr.to_string()
        } else {
            format!("http://{addr}")
        };
        let mut proxy = reqwest::Proxy::all(&url).map_err(|e| format!("代理配置错误: {e}"))?;
        if let Some(no_proxy) =
            reqwest::NoProxy::from_string("localhost,127.0.0.1,::1,[::1]")
        {
            proxy = proxy.no_proxy(Some(no_proxy));
        }
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| e.to_string())
}

pub fn build_client(
    cookie_store: Arc<CookieStoreMutex>,
    proxy_type: &str,
    proxy_addr: &str,
) -> Result<reqwest::Client, String> {
    build_client_inner(
        cookie_store,
        proxy_type,
        proxy_addr,
        Some(std::time::Duration::from_secs(90)),
    )
}

/// A client without a global timeout so long media streams are not cut off.
pub fn build_media_client(
    cookie_store: Arc<CookieStoreMutex>,
    proxy_type: &str,
    proxy_addr: &str,
) -> Result<reqwest::Client, String> {
    build_client_inner(cookie_store, proxy_type, proxy_addr, None)
}

// ---------------------------------------------------------------------------
// Simple JSON database persisted next to the cookies file.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct DbEnvelope {
    version: u32,
    data: serde_json::Value,
}

#[tauri::command]
pub fn db_load(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = data_dir(&app)?.join("database.json");
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<DbEnvelope>(&content) {
        Ok(envelope) => Ok(envelope.data),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub fn db_save(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("database.json");
    let tmp = path.with_extension("json.tmp");
    let envelope = DbEnvelope { version: 1, data };
    let content = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn app_paths(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = data_dir(&app)?;
    Ok(serde_json::json!({
        "data": dir.to_string_lossy(),
        "extensions": dir.join("extensions").to_string_lossy(),
        "logs": dir.join("logs").to_string_lossy(),
    }))
}

// ---------------------------------------------------------------------------
// Log file helpers
// ---------------------------------------------------------------------------

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("logs").join("kiru.log"))
}

#[tauri::command]
pub fn log_append(app: AppHandle, line: String) -> Result<(), String> {
    let path = log_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    if file.metadata().map(|m| m.len() > 10 * 1024 * 1024).unwrap_or(false) {
        drop(file);
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn log_read(app: AppHandle) -> Result<String, String> {
    let path = log_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_clear(app: AppHandle) -> Result<(), String> {
    let path = log_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn log_export(app: AppHandle, target: String) -> Result<(), String> {
    let path = log_path(&app)?;
    if !path.exists() {
        return Err("日志文件不存在".into());
    }
    fs::copy(path, target).map_err(|e| e.to_string())?;
    Ok(())
}
