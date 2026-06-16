mod db;
mod error;

use error::AppError;
use tauri::Manager;

/// Health check: proves the Rust → SQLite pipeline by reading the applied
/// schema version. Called from the frontend on startup.
#[tauri::command]
fn db_health(db: tauri::State<db::Db>) -> Result<String, AppError> {
    let conn = db
        .0
        .lock()
        .map_err(|_| AppError::Other("db lock poisoned".into()))?;
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(format!("DB OK — schema v{user_version}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db = db::init(app.handle())?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_health])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
