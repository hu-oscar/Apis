// Apis Provider — Tauri shell that manages the apis_worker Python
// subprocess and exposes a small command surface to the React UI.

mod worker;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(worker::WorkerState::new()))
        .invoke_handler(tauri::generate_handler![
            worker::start_worker,
            worker::stop_worker,
            worker::worker_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
