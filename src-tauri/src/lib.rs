pub mod git;
pub mod records;
pub mod sync;

// ── Entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            records::list_sync_records,
            records::save_sync_record,
            records::delete_sync_record,
            sync::sync_direct,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
