fn main() {
    let mut attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_version",
            "check_for_update",
            "store_desktop_token",
            "clear_desktop_token",
            "get_sync_status",
            "list_cached_stock",
            "record_offline_adjustment",
            "sync_now",
        ]),
    );

    // MinGW's default CRT links its own manifest resource, which collides with
    // the one Tauri embeds by default — only affects local GNU-target builds.
    // The real MSVC release build (CI) is unaffected and keeps the normal
    // Tauri-provided manifest (DPI awareness, Common Controls v6).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
