// Apis Provider — Tauri shell that manages the apis_worker Python
// subprocess and exposes a small command surface to the React UI.

mod tray;
mod worker;

use std::sync::Arc;

use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Arc::new(worker::WorkerState::new()))
        // Closing the window must NOT terminate the worker — the user
        // expects the menu-bar tray to keep the runtime alive in the
        // background. Intercept the close request, prevent the default
        // behavior, and hide the window instead. Quit is reachable from
        // the tray's "Quit Apis Provider" item.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            tray::build_tray(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            worker::start_worker,
            worker::stop_worker,
            worker::worker_status,
            worker::derive_provider_pda,
            worker::register_provider_subprocess,
            tray::set_tray_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
