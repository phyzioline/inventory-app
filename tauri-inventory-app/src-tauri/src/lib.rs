use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Runtime,
};
use tauri_plugin_updater::UpdaterExt;

mod db;
mod sync;

/// Expose app version to the webview via JavaScript
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Called by the webview to request an update check immediately
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(_) => Ok(true),
        None    => Ok(false),
    }
}

pub fn run() {
    tauri::Builder::default()
        // ── Plugins ────────────────────────────────────────────────────────────
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        // ── Commands ───────────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            check_for_update,
            sync::store_desktop_token,
            sync::clear_desktop_token,
            sync::get_sync_status,
            sync::list_cached_stock,
            sync::record_offline_adjustment,
            sync::sync_now,
        ])
        // ── Setup ──────────────────────────────────────────────────────────────
        .setup(|app| {
            // ── Offline sync state (local SQLite cache + outbox) ───────────────
            let sync_state = sync::init_state(app.handle())?;
            app.manage(sync_state);

            // ── System Tray ───────────────────────────────────────────────────
            let quit    = MenuItem::with_id(app, "quit",  "Quit Phyzioline Inventory", true, None::<&str>)?;
            let open    = MenuItem::with_id(app, "open",  "Open",            true, None::<&str>)?;
            let menu    = Menu::with_items(app, &[&open, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Minimize to tray on close ─────────────────────────────────────
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event({
                    let window = window.clone();
                    move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                });
            }

            // ── Inject app version into webview localStorage ──────────────────
            // The ERP page reads phy_desktop_version to show update badge
            let version = env!("CARGO_PKG_VERSION").to_string();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&format!(
                    "localStorage.setItem('phy_desktop_version', '{}');",
                    version
                ));
            }

            // ── Silent update check on startup ────────────────────────────────
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(updater) = app_handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        // Show dialog (configured in tauri.conf.json → plugins.updater.dialog)
                        let _ = update.download_and_install(|_, _| {}, || {}).await;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Phyzioline Inventory");
}
