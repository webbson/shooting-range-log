mod backup;
mod checkout;
mod commands;
mod crypto;
pub mod db;
mod debt;
mod error;
mod import;
mod logs;
mod models;
pub mod seed;
mod s3;
mod service;
mod settings;

use std::time::Duration;

use error::AppError;
use tauri::{AppHandle, Manager};

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

/// Encrypt a local backup and upload it to S3.
async fn upload_encrypted(
    _app: &AppHandle,
    path: &std::path::Path,
    settings: &settings::Settings,
) -> Result<(), AppError> {
    let passphrase = settings
        .backup_passphrase
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_passphrase_required",
                "Backup passphrase not set",
                serde_json::json!({}),
            )
        })?;
    let data = std::fs::read(path)?;
    let encrypted = crypto::encrypt(&data, passphrase)?;
    let filename = path.file_name().unwrap().to_string_lossy().into_owned();
    let key = s3::s3_key(settings, &filename);
    s3::upload(settings, &key, &encrypted).await?;
    // Local file was just staging — remove it now that remote copy is durable.
    let _ = std::fs::remove_file(path);
    s3::retention_remote(settings).await
}

/// Test S3 connectivity using the settings passed from the form (no DB read required).
#[tauri::command]
async fn test_s3_connection(input: settings::Settings) -> Result<String, AppError> {
    s3::test_connection(&input).await
}

/// Take an immediate local snapshot. Spawns async S3 upload if configured. Returns snapshot filename.
#[tauri::command]
fn backup_now(
    db: tauri::State<'_, db::Db>,
    backup_dir: tauri::State<'_, backup::BackupDir>,
    app: AppHandle,
) -> Result<String, AppError> {
    let path = {
        let conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        backup::snapshot_local(&conn, &backup_dir.0)?
    };
    backup::retention_local(&backup_dir.0)?;
    let filename = path.file_name().unwrap().to_string_lossy().into_owned();

    let app2 = app.clone();
    let path2 = path.clone();
    tauri::async_runtime::spawn(async move {
        let settings = {
            let db = app2.state::<db::Db>();
            let Ok(conn) = db.0.lock() else { return };
            match settings::get_settings_inner(&conn) {
                Ok(s) => s,
                Err(_) => return,
            }
        };
        if settings.s3_endpoint.is_some() && settings.backup_passphrase.is_some() {
            if let Err(e) = upload_encrypted(&app2, &path2, &settings).await {
                eprintln!("[backup] S3 upload failed: {e}");
            }
        }
    });

    Ok(filename)
}

/// List local and remote backups merged, newest first.
#[tauri::command]
async fn list_backups(
    db: tauri::State<'_, db::Db>,
    backup_dir: tauri::State<'_, backup::BackupDir>,
) -> Result<Vec<backup::BackupInfo>, AppError> {
    let settings = {
        let conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        settings::get_settings_inner(&conn)?
    };

    let mut all = backup::list_local(&backup_dir.0)?;

    if settings.s3_endpoint.is_some() && settings.s3_bucket.is_some() {
        match s3::list_remote(&settings).await {
            Ok(remote) => all.extend(remote),
            Err(e) => eprintln!("[backup] list remote failed: {e}"),
        }
    }

    all.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(all)
}

/// Restore the DB from a backup. source = "local" or "remote".
#[tauri::command]
async fn restore_backup(
    db: tauri::State<'_, db::Db>,
    backup_dir: tauri::State<'_, backup::BackupDir>,
    filename: String,
    source: String,
) -> Result<(), AppError> {
    let local_path = backup_dir.0.join(&filename);

    if source == "local" {
        let mut conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        backup::restore_from_file(&mut conn, &local_path)?;
        return Ok(());
    }

    // Remote: download + decrypt + restore from temp file.
    let settings = {
        let conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        settings::get_settings_inner(&conn)?
    };

    let passphrase = settings
        .backup_passphrase
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "err_passphrase_required",
                "Backup passphrase required to restore from remote",
                serde_json::json!({}),
            )
        })?
        .to_owned();

    let key = s3::s3_key(&settings, &filename);
    let encrypted = s3::download(&settings, &key).await?;
    let decrypted = crypto::decrypt(&encrypted, &passphrase)?;

    // Write decrypted bytes to a temp file, restore from it, then delete.
    let tmp_path = backup_dir.0.join(format!(".tmp-restore-{filename}"));
    std::fs::write(&tmp_path, &decrypted)?;
    let restore_result = {
        let mut conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        backup::restore_from_file(&mut conn, &tmp_path)
    };
    let _ = std::fs::remove_file(&tmp_path);
    restore_result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = db::init(app.handle())?;
            app.manage(db);

            // Backup directory: <app_data_dir>/backups
            let backup_dir_path = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::internal(format!("app_data_dir: {e}")))?
                .join("backups");
            std::fs::create_dir_all(&backup_dir_path).ok();
            app.manage(backup::BackupDir(backup_dir_path));

            // Production kiosk: maximize and grab focus once at startup. In dev the
            // window stays small and unfocused (config `focus: false`) so the
            // rebuild-driven relaunch on each Rust change doesn't steal focus.
            #[cfg(not(debug_assertions))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.maximize();
                let _ = win.set_focus();
            }

            // Timer thread: snapshot every 10 minutes unconditionally.
            // VACUUM INTO on a small SQLite is near-instant.
            let app_timer = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(600));

                    let db = app_timer.state::<db::Db>();
                    let bdir = app_timer.state::<backup::BackupDir>();

                    let snapshot_path: Option<std::path::PathBuf> = {
                        let Ok(conn) = db.0.lock() else { continue };
                        match backup::snapshot_local(&conn, &bdir.0) {
                            Ok(p) => Some(p),
                            Err(e) => {
                                eprintln!("[backup] snapshot failed: {e}");
                                None
                            }
                        }
                    };

                    let _ = backup::retention_local(&bdir.0);

                    if let Some(path) = snapshot_path {
                        let app2 = app_timer.clone();
                        tauri::async_runtime::spawn(async move {
                            let settings = {
                                let db = app2.state::<db::Db>();
                                let Ok(conn) = db.0.lock() else { return };
                                match settings::get_settings_inner(&conn) {
                                    Ok(s) => s,
                                    Err(_) => return,
                                }
                            };
                            if settings.s3_endpoint.is_some()
                                && settings.backup_passphrase.is_some()
                            {
                                if let Err(e) = upload_encrypted(&app2, &path, &settings).await {
                                    eprintln!("[backup] S3 upload failed: {e}");
                                }
                            }
                        });
                    }
                }
            });

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
            commands::set_preferred_weapon,
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
            logs::last_weapon_users,
            service::add_service,
            service::list_weapon_service,
            import::import_list_sheets,
            import::import_preview,
            import::import_commit,
            settings::get_settings,
            settings::update_settings,
            test_s3_connection,
            backup_now,
            list_backups,
            restore_backup,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let bdir_path = app_handle.state::<backup::BackupDir>().0.clone();
                {
                    let db = app_handle.state::<db::Db>();
                    if let Ok(conn) = db.0.lock() {
                        let _ = backup::snapshot_local(&conn, &bdir_path);
                        let _ = backup::retention_local(&bdir_path);
                    };
                }
            }
        });
}
