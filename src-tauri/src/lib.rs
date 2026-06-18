mod checkout;
mod commands;
pub mod db;
mod debt;
mod error;
mod import;
mod logs;
mod models;
pub mod seed;
mod service;
mod settings;

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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = db::init(app.handle())?;
            app.manage(db);
            // Production kiosk: maximize and grab focus once at startup. In dev the
            // window stays small and unfocused (config `focus: false`) so the
            // rebuild-driven relaunch on each Rust change doesn't steal focus.
            #[cfg(not(debug_assertions))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.maximize();
                let _ = win.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_health,
            commands::list_users,
            commands::list_operators,
            commands::get_user,
            commands::next_user_display_id,
            commands::create_user,
            commands::update_user,
            commands::set_user_active,
            commands::list_weapons,
            commands::get_weapon,
            commands::next_weapon_display_id,
            commands::create_weapon,
            commands::update_weapon,
            commands::set_weapon_active,
            checkout::evaluate_checkout,
            checkout::checkout,
            checkout::checkin,
            checkout::list_open_checkouts,
            debt::add_debt,
            debt::list_user_debts,
            debt::settle_debt,
            debt::outstanding_debts,
            logs::list_checkouts,
            logs::last_shot_dates,
            service::add_service,
            service::list_weapon_service,
            import::import_list_sheets,
            import::import_preview,
            import::import_commit,
            settings::get_settings,
            settings::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
