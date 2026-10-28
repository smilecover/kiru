use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::proxy::make_media_url;
use crate::store::{data_dir, AppState};

#[derive(Deserialize)]
pub struct ExternalSubtitle {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
}

fn sanitize_filename(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.len() > 80 {
        out.truncate(80);
    }
    if out.is_empty() {
        out = "subtitle".into();
    }
    out
}

fn subtitle_extension(url: &str, title: Option<&str>) -> &'static str {
    let mut candidates = Vec::new();
    if let Ok(url) = Url::parse(url) {
        candidates.push(url.path().to_lowercase());
    }
    if let Some(title) = title {
        candidates.push(title.to_lowercase());
    }
    for candidate in candidates {
        for (suffix, ext) in [
            (".srt", ".srt"),
            (".vtt", ".vtt"),
            (".ass", ".ass"),
            (".ssa", ".ssa"),
            (".ttml", ".ttml"),
        ] {
            if candidate.ends_with(suffix) {
                return ext;
            }
        }
    }
    ".srt"
}

async fn download_subtitles(
    app: &AppHandle,
    headers: &HashMap<String, String>,
    subtitles: &[ExternalSubtitle],
) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if subtitles.is_empty() {
        return result;
    }
    let state = app.state::<Arc<AppState>>();
    let client = state.client();
    let Ok(dir) = data_dir(app).map(|dir| dir.join("cache").join("subtitles")) else {
        return result;
    };
    let _ = std::fs::create_dir_all(&dir);
    let _ = cleanup_old_subtitles(&dir);

    for (index, subtitle) in subtitles.iter().enumerate() {
        let extension = subtitle_extension(&subtitle.url, subtitle.title.as_deref());
        let base = subtitle
            .title
            .clone()
            .or_else(|| {
                Url::parse(&subtitle.url)
                    .ok()
                    .and_then(|u| {
                        u.path_segments()
                            .and_then(|mut s| s.next_back().map(|v| v.to_string()))
                    })
            })
            .unwrap_or_else(|| format!("subtitle-{index}"));
        let filename = format!(
            "{}-{}{}",
            uuid::Uuid::new_v4().simple(),
            sanitize_filename(&base),
            if base.to_lowercase().ends_with(extension) {
                ""
            } else {
                extension
            }
        );
        let path = dir.join(filename);
        let mut request = client.get(&subtitle.url);
        for (key, value) in headers {
            request = request.header(key, value);
        }
        let response = match request.send().await {
            Ok(response) if response.status().is_success() => response,
            _ => continue,
        };
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if std::fs::write(&path, &bytes).is_ok() {
            result.push(path);
        }
    }
    result
}

fn cleanup_old_subtitles(dir: &Path) -> Result<(), std::io::Error> {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(7 * 24 * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    for entry in std::fs::read_dir(dir)?.flatten() {
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}

fn find_windows_vlc() -> Option<PathBuf> {
    for base in [
        std::env::var("ProgramFiles").ok(),
        std::env::var("ProgramFiles(x86)").ok(),
    ]
    .into_iter()
    .flatten()
    {
        let path = PathBuf::from(base)
            .join("VideoLAN")
            .join("VLC")
            .join("vlc.exe");
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn spawn_player(program: &str, args: &[String]) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动 {program} 失败: {e}"))
}

fn launch(player: &str, url: &str, subtitles: &[PathBuf], headers: &HashMap<String, String>) -> Result<(), String> {
    let subtitle_args = |flag: &str| -> Vec<String> {
        subtitles
            .iter()
            .map(|path| format!("{flag}{}", path.to_string_lossy()))
            .collect()
    };

    #[cfg(target_os = "windows")]
    {
        match player {
            "vlc" => {
                let program = find_windows_vlc()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_else(|| "vlc".to_string());
                let mut args = vec![url.to_string()];
                if let Some(referer) = headers.get("Referer").or_else(|| headers.get("referer")) {
                    args.push(format!("--http-referrer={referer}"));
                }
                if let Some(ua) = headers
                    .get("User-Agent")
                    .or_else(|| headers.get("user-agent"))
                {
                    args.push(format!("--http-user-agent={ua}"));
                }
                args.extend(subtitle_args("--sub-file="));
                spawn_player(&program, &args)
            }
            "mpv" => {
                let mut args = vec![url.to_string()];
                args.extend(subtitle_args("--sub-file="));
                spawn_player("mpv", &args)
            }
            "potplayer" => {
                let protocol = format!("potplayer://{url}");
                spawn_player("cmd", &["/C".into(), "start".into(), "".into(), protocol])
            }
            _ => {
                // Let the system pick a handler for the URL.
                spawn_player("cmd", &["/C".into(), "start".into(), "".into(), url.to_string()])
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match player {
            "vlc" => {
                let mut args = vec![url.to_string()];
                args.extend(subtitle_args("--sub-file="));
                spawn_player("vlc", &args)
            }
            "mpv" => {
                let mut args = vec![url.to_string()];
                args.extend(subtitle_args("--sub-file="));
                spawn_player("mpv", &args)
            }
            _ => spawn_player("xdg-open", &[url.to_string()]),
        }
    }

    #[cfg(target_os = "macos")]
    {
        match player {
            "vlc" => {
                let mut args = vec![
                    "-a".to_string(),
                    "VLC".to_string(),
                    url.to_string(),
                    "--args".to_string(),
                ];
                args.extend(subtitle_args("--sub-file="));
                spawn_player("open", &args)
            }
            "mpv" => {
                let mut args = vec![url.to_string()];
                args.extend(subtitle_args("--sub-file="));
                spawn_player("mpv", &args)
            }
            _ => spawn_player("open", &[url.to_string()]),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (player, url, subtitles, headers);
        Err("当前平台不支持外部播放器".into())
    }
}

#[tauri::command]
pub async fn launch_external_player(
    app: AppHandle,
    player: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    subtitles: Option<Vec<ExternalSubtitle>>,
) -> Result<(), String> {
    let headers = headers.unwrap_or_default();
    let state = app.state::<Arc<AppState>>();
    let base = state.proxy_base.read().unwrap().clone();
    let media_url = if base.is_empty() {
        url.clone()
    } else {
        make_media_url(&base, &url, &headers)
    };
    let downloaded = download_subtitles(
        &app,
        &headers,
        &subtitles.unwrap_or_default(),
    )
    .await;
    launch(&player, &media_url, &downloaded, &headers)
}
