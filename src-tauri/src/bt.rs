use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::store::{data_dir, AppState};

const RELEASE_API: &str = "https://api.github.com/repos/miru-project/bt-server/releases/latest";
const LOCAL_API: &str = "http://localhost:3000";

#[derive(Serialize, Clone)]
pub struct BtStatus {
    pub running: bool,
    pub version: String,
    pub installed: bool,
}

fn is_windows() -> bool {
    cfg!(windows)
}

fn server_filename() -> &'static str {
    if is_windows() {
        "btserver.exe"
    } else {
        "btserver"
    }
}

fn server_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(server_filename()))
}

fn asset_arch() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        match std::env::consts::ARCH {
            "x86_64" => Ok("amd64"),
            "aarch64" => Ok("arm64"),
            "x86" => Ok("386"),
            "arm" => Ok("arm"),
            _ => Err("当前架构不受支持".into()),
        }
    } else if cfg!(target_os = "linux") {
        match std::env::consts::ARCH {
            "x86_64" => Ok("amd64"),
            "aarch64" => Ok("arm64"),
            "x86" => Ok("386"),
            "arm" => Ok("arm"),
            _ => Err("当前架构不受支持".into()),
        }
    } else {
        Err("当前平台暂不支持 BT Server".into())
    }
}

fn asset_platform() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        Ok("windows")
    } else if cfg!(target_os = "linux") {
        Ok("linux")
    } else {
        Err("当前平台暂不支持 BT Server".into())
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
}

async fn fetch_remote_version(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<Arc<AppState>>();
    let response = state
        .client()
        .get(RELEASE_API)
        .header("User-Agent", "Kiru/0.1.0")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("获取版本失败: HTTP {}", response.status()));
    }
    let release: Release = response.json().await.map_err(|e| e.to_string())?;
    Ok(release.tag_name.trim_start_matches('v').to_string())
}

#[tauri::command]
pub async fn bt_remote_version(app: AppHandle) -> Result<String, String> {
    fetch_remote_version(&app).await
}

#[tauri::command]
pub async fn bt_install(app: AppHandle) -> Result<String, String> {
    let state = app.state::<Arc<AppState>>();
    let remote = fetch_remote_version(&app).await?;
    let platform = asset_platform()?;
    let arch = asset_arch()?;
    let tag = format!("v{remote}");
    let suffix = if is_windows() { ".exe" } else { "" };
    let asset = format!("bt-server-{tag}-{platform}-{arch}{suffix}");
    let url = format!(
        "https://github.com/miru-project/bt-server/releases/download/{tag}/{asset}"
    );

    let response = state
        .client()
        .get(&url)
        .header("User-Agent", "Kiru/0.1.0")
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "下载 BT Server 失败: HTTP {} ({})",
            response.status(),
            url
        ));
    }
    let total = response.content_length().unwrap_or(0);
    let dir = data_dir(&app)?;
    let path = dir.join(server_filename());
    let tmp = dir.join(format!("{}.download", server_filename()));

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(120) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "bt-download-progress",
                serde_json::json!({ "received": received, "total": total }),
            );
        }
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| e.to_string())?;
    drop(file);
    let _ = app.emit(
        "bt-download-progress",
        serde_json::json!({ "received": received, "total": total }),
    );

    if is_windows() {
        // If a previous server is running it locks the executable.
        stop_child(&app);
    }
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    Ok(remote)
}

#[tauri::command]
pub fn bt_is_installed(app: AppHandle) -> Result<bool, String> {
    Ok(server_path(&app)?.exists())
}

fn stop_child(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    if let Ok(mut guard) = state.bt_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub fn bt_start(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    {
        let guard = state.bt_child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
    }
    let path = server_path(&app)?;
    if !path.exists() {
        return Err("BT Server 未安装".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let mut command = Command::new(&path);
    command
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = command
        .spawn()
        .map_err(|e| format!("启动 BT Server 失败: {e}"))?;
    let mut guard = state.bt_child.lock().map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn bt_stop(app: AppHandle) -> Result<(), String> {
    stop_child(&app);
    Ok(())
}

#[tauri::command]
pub fn bt_uninstall(app: AppHandle) -> Result<(), String> {
    stop_child(&app);
    let path = server_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("卸载失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn bt_status(app: AppHandle) -> Result<BtStatus, String> {
    let installed = server_path(&app)?.exists();
    let running = app
        .state::<Arc<AppState>>()
        .bt_child
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);
    let mut version = String::new();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(response) = client.get(format!("{LOCAL_API}/version")).send().await {
        if response.status().is_success() {
            version = response.text().await.unwrap_or_default().trim().to_string();
        }
    }
    Ok(BtStatus {
        running: running && !version.is_empty(),
        version,
        installed,
    })
}

#[tauri::command]
pub async fn bt_add_torrent(
    app: AppHandle,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let state = app.state::<Arc<AppState>>();
    let mut request = state.client().get(&url);
    if let Some(headers) = headers {
        for (key, value) in headers {
            if key.eq_ignore_ascii_case("host") || key.eq_ignore_ascii_case("content-length") {
                continue;
            }
            request = request.header(key, value);
        }
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("下载种子失败: HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{LOCAL_API}/torrent"))
        .header("Content-Type", "application/x-bittorrent")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("BT Server 未运行: {e}"))?;
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("添加种子失败: {body}"));
    }
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {e}"))?;
    data.get("infoHash")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .ok_or_else(|| "未获取到 infoHash".to_string())
}

#[tauri::command]
pub async fn bt_files(app: AppHandle, info_hash: String) -> Result<Vec<String>, String> {
    let _ = app;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{LOCAL_API}/torrent/{info_hash}"))
        .send()
        .await
        .map_err(|e| format!("BT Server 未运行: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("获取文件列表失败: HTTP {}", response.status()));
    }
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let files = data
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "响应中缺少 files".to_string())?;
    Ok(files
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect())
}

#[tauri::command]
pub async fn bt_remove_torrent(app: AppHandle, info_hash: String) -> Result<(), String> {
    let _ = app;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .delete(format!("{LOCAL_API}/torrent/{info_hash}"))
        .send()
        .await
        .map_err(|e| format!("BT Server 未运行: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("移除种子失败: HTTP {}", response.status()));
    }
    Ok(())
}

fn percent_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '/') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[tauri::command]
pub fn bt_stream_url(info_hash: String, file: String) -> Result<String, String> {
    Ok(format!(
        "{LOCAL_API}/torrent/{info_hash}/{}",
        percent_encode_path(&file)
    ))
}
