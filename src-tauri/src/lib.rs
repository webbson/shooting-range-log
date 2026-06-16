mod checkout;
mod commands;
mod db;
mod error;
mod models;

use error::AppError;
use tauri::Manager;

/// Health check: proves the Rust → SQLite pipeline by reading the applied
/// schema version. Called from the frontend on startup.
#[tauri::command]
fn db_health(db: tauri::State<db::Db>) -> Result<String, AppError> {
    let conn = db
        .0
        .lock()
        .map_err(|_| AppError::internal("db lock poisoned"))?;
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
        .invoke_handler(tauri::generate_handler![
            db_health,
            commands::list_users,
            commands::list_operators,
            commands::get_user,
            commands::create_user,
            commands::update_user,
            commands::set_user_active,
            commands::list_weapons,
            commands::get_weapon,
            commands::create_weapon,
            commands::update_weapon,
            commands::set_weapon_active,
            checkout::evaluate_checkout,
            checkout::checkout,
            checkout::checkin,
            checkout::list_open_checkouts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
