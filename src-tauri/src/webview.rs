use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const ANILIST_AUTH_URL: &str =
    "https://anilist.co/api/v2/oauth/authorize?client_id=16214&response_type=token";
const CAPTURE_HOST: &str = "kiru-cookie-capture.invalid";
const MOBILE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Kiru/0.1.0";

fn parse_params(value: &str) -> Vec<(String, String)> {
    Url::parse(&format!("https://kiru.local/?{value}"))
        .map(|url| {
            url.query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn open_anilist_login(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("anilist-login") {
        let _ = existing.close();
    }
    let auth_url = Url::parse(ANILIST_AUTH_URL).map_err(|e| e.to_string())?;
    let handle = app.clone();
    let builder = WebviewWindowBuilder::new(&app, "anilist-login", WebviewUrl::External(auth_url))
        .title("AniList Login / AniList 登录")
        .inner_size(980.0, 760.0)
        .min_inner_size(600.0, 500.0)
        .center()
        .user_agent(MOBILE_USER_AGENT)
        .on_navigation(move |url| {
            let mut token: Option<String> = None;
            let mut error: Option<String> = None;
            if let Some(fragment) = url.fragment() {
                for (key, value) in parse_params(fragment) {
                    if key == "access_token" {
                        token = Some(value);
                    } else if key == "error" || key == "error_description" {
                        error = Some(value);
                    }
                }
            }
            for (key, value) in url.query_pairs() {
                if key == "access_token" {
                    token = Some(value.to_string());
                } else if key == "error" || key == "error_description" {
                    error = Some(value.to_string());
                }
            }
            if token.is_none() && error.is_none() {
                return true;
            }
            let handle = handle.clone();
            if let Some(token) = token {
                let _ = handle.emit("anilist-token", serde_json::json!({ "token": token }));
            } else if let Some(error) = error {
                let _ = handle.emit("anilist-error", serde_json::json!({ "error": error }));
            }
            if let Some(window) = handle.get_webview_window("anilist-login") {
                let _ = window.close();
            }
            false
        });
    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

fn capture_script() -> String {
    r#"
(function () {
  if (window.__kiruCookieButton) return;
  function install() {
    if (!document.body || window.__kiruCookieButton) return;
    window.__kiruCookieButton = true;
    var button = document.createElement('button');
    button.textContent = 'Save Cookies / 保存 Cookie';
    button.setAttribute('style', [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
      'padding:10px 16px', 'border-radius:10px', 'border:none',
      'background:#0ea5e9', 'color:#fff', 'font-size:14px', 'font-weight:600',
      'font-family:system-ui,-apple-system,sans-serif', 'cursor:pointer',
      'box-shadow:0 6px 20px rgba(0,0,0,.35)'
    ].join(';'));
    button.addEventListener('click', function () {
      var target = location.href;
      var cookies = '';
      try { cookies = document.cookie || ''; } catch (e) {}
      location.href = 'https://__CAPTURE_HOST__/capture?url=' +
        encodeURIComponent(target) + '&cookies=' + encodeURIComponent(cookies);
    });
    document.body.appendChild(button);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
"#
    .replace("__CAPTURE_HOST__", CAPTURE_HOST)
}

#[tauri::command]
pub async fn open_site_window(
    app: AppHandle,
    url: String,
    title: Option<String>,
) -> Result<String, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("URL 无效: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("仅支持 http/https 地址".into());
    }
    let label = format!(
        "site-{}",
        uuid::Uuid::new_v4().simple().to_string()
    );
    let handle = app.clone();
    let label_for_nav = label.clone();
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "Kiru - 获取 Cookie".into()))
        .inner_size(1024.0, 768.0)
        .min_inner_size(500.0, 400.0)
        .center()
        .user_agent(MOBILE_USER_AGENT)
        .initialization_script(capture_script())
        .on_navigation(move |url| {
            if url.host_str() != Some(CAPTURE_HOST) {
                return true;
            }
            let target = url
                .query_pairs()
                .find(|(k, _)| k == "url")
                .map(|(_, v)| v.to_string());
            let Some(target) = target else {
                return false;
            };
            let handle = handle.clone();
            let label = label_for_nav.clone();
            let fallback = url
                .query_pairs()
                .find(|(k, _)| k == "cookies")
                .map(|(_, v)| v.to_string())
                .unwrap_or_default();
            // Reading cookies on Windows deadlocks if done on the event loop thread.
            std::thread::spawn(move || {
                let mut cookies = fallback;
                if let Some(window) = handle.get_webview_window(&label) {
                    if let Ok(target_url) = Url::parse(&target) {
                        if let Ok(list) = window.cookies_for_url(target_url) {
                            let joined = list
                                .iter()
                                .map(|c| format!("{}={}", c.name(), c.value()))
                                .collect::<Vec<_>>()
                                .join("; ");
                            if !joined.is_empty() {
                                cookies = joined;
                            }
                        }
                    }
                }
                let _ = handle.emit(
                    "site-cookies",
                    serde_json::json!({
                        "label": label,
                        "url": target,
                        "cookies": cookies,
                    }),
                );
                if let Some(window) = handle.get_webview_window(&label) {
                    let _ = window.close();
                }
            });
            false
        });
    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(label)
}

#[tauri::command]
pub async fn open_url_window(
    app: AppHandle,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("URL 无效: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("仅支持 http/https 地址".into());
    }
    let label = format!("web-{}", uuid::Uuid::new_v4().simple().to_string());
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "Kiru".into()))
        .inner_size(1100.0, 800.0)
        .min_inner_size(500.0, 400.0)
        .center()
        .user_agent(MOBILE_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}
