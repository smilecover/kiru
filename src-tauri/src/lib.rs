mod bt;
mod dlna;
mod extensions;
mod external;
mod http;
mod proxy;
mod store;
mod webview;

use std::sync::Arc;

use store::AppState;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = Arc::new(
                AppState::new(app.handle()).map_err(std::io::Error::other)?,
            );
            app.manage(state.clone());
            tauri::async_runtime::block_on(proxy::start_proxy(state))
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::db_load,
            store::db_save,
            store::app_paths,
            store::log_append,
            store::log_read,
            store::log_clear,
            store::log_export,
            http::http_request,
            http::net_config,
            http::cookies_get,
            http::cookies_set,
            http::cookies_clear,
            proxy::media_proxy_url,
            proxy::proxy_base,
            bt::bt_remote_version,
            bt::bt_install,
            bt::bt_is_installed,
            bt::bt_start,
            bt::bt_stop,
            bt::bt_uninstall,
            bt::bt_status,
            bt::bt_add_torrent,
            bt::bt_files,
            bt::bt_remove_torrent,
            bt::bt_stream_url,
            webview::open_anilist_login,
            webview::open_site_window,
            webview::open_url_window,
            external::launch_external_player,
            dlna::dlna_discover,
            dlna::dlna_action,
            extensions::extensions_list,
            extensions::extension_read,
            extensions::extension_write,
            extensions::extension_delete,
            extensions::extension_exists,
            extensions::extensions_path,
            extensions::read_text_file,
            extensions::write_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kiru");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                if let Ok(mut guard) = state.bt_child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                state.save_cookies();
            }
        }
    });
}
