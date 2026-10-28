use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::store::data_dir;

#[derive(Serialize)]
pub struct ExtensionFile {
    pub filename: String,
    pub content: String,
}

pub fn extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("extensions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_filename(filename: &str) -> Result<&str, String> {
    let name = filename.trim();
    if name.is_empty()
        || !name.ends_with(".js")
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err("非法的扩展文件名".into());
    }
    Ok(name)
}

#[tauri::command]
pub fn extensions_list(app: AppHandle) -> Result<Vec<ExtensionFile>, String> {
    let dir = extensions_dir(&app)?;
    let mut result = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|v| v.to_str()) != Some("js") {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_string();
        if let Ok(content) = fs::read_to_string(&path) {
            result.push(ExtensionFile { filename, content });
        }
    }
    result.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(result)
}

#[tauri::command]
pub fn extension_read(app: AppHandle, filename: String) -> Result<String, String> {
    let name = safe_filename(&filename)?;
    let path = extensions_dir(&app)?.join(name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn extension_write(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<(), String> {
    let name = safe_filename(&filename)?;
    let dir = extensions_dir(&app)?;
    let path = dir.join(name);
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn extension_delete(app: AppHandle, filename: String) -> Result<(), String> {
    let name = safe_filename(&filename)?;
    let path = extensions_dir(&app)?.join(name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn extension_exists(app: AppHandle, filename: String) -> Result<bool, String> {
    let name = safe_filename(&filename)?;
    Ok(extensions_dir(&app)?.join(name).exists())
}

#[tauri::command]
pub fn extensions_path(app: AppHandle) -> Result<String, String> {
    Ok(extensions_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > 32 * 1024 * 1024 {
        return Err("文件过大".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}
