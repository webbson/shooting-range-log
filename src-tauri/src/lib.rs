mod background;
mod backup;
mod checkout;
mod commands;
mod crypto;
pub mod db;
mod debt;
mod error;
mod import;
mod logs;
mod member_import;
mod models;
pub mod seed;
mod s3;
mod service;
mod settings;
mod stats;

use std::time::Duration;

use error::AppError;
use serde::Serialize;
use std::sync::Mutex;

use tauri::{Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_opener::OpenerExt;

/// Result of `backup_now`: the local snapshot always happened by the time
/// this returns; `remote`/`remote_error` report the S3 upload + retention
/// pass, kept separate so a remote hiccup never turns a good local backup
/// into a failed command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupNowResult {
    filename: String,
    remote: Option<s3::RetentionSummary>,
    remote_error: Option<String>,
}

/// eprintln! the outcome of one upload_encrypted call — dev-only visibility
/// (release builds run windows_subsystem = "windows", no stderr sink), but
/// cheap and better than nothing; `backup_now`'s toast is the production
/// channel for this same information.
fn log_backup_upload_outcome(outcome: &Result<(Option<s3::RetentionSummary>, Option<String>), AppError>) {
    match outcome {
        Ok((Some(summary), _)) => {
            eprintln!(
                "[backup] remote retention: listed={} due={} deleted={} failed={} notAttempted={}",
                summary.listed, summary.due, summary.deleted, summary.failed.len(), summary.not_attempted
            );
            if let Some(first) = summary.failed.first() {
                eprintln!("[backup] remote retention first failure: {} — {}", first.key, first.error);
            }
        }
        Ok((None, Some(err))) => eprintln!("[backup] remote retention failed: {err}"),
        Ok((None, None)) => {}
        Err(e) => eprintln!("[backup] S3 upload failed: {e}"),
    }
}

/// Windowed geometry saved when kiosk mode is entered, so leaving it puts the
/// window back where it was instead of leaving a decorated, screen-sized window.
#[derive(Default)]
struct WindowedGeometry(Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>>);

/// Kiosk mode: an undecorated, always-on-top window covering the current
/// monitor. Deliberately NOT the OS fullscreen state — on Windows that switches
/// the display mode (the screen visibly flickers) and the WebView then stops
/// rendering the app's own cursor, which is the only visible one in light mode.
/// Sizing the window to the monitor achieves the same kiosk look with no mode
/// switch: no flicker, no cursor loss, taskbar still covered.
#[tauri::command]
fn set_kiosk(
    window: tauri::Window,
    saved: tauri::State<WindowedGeometry>,
    on: bool,
) -> Result<(), AppError> {
    let err = |what: &str, e: tauri::Error| AppError::internal(format!("{what}: {e}"));

    if on {
        let monitor = window
            .current_monitor()
            .map_err(|e| err("current_monitor", e))?
            .ok_or_else(|| AppError::internal("no monitor found for this window"))?;

        // Remember the windowed geometry before covering the screen.
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            *saved
                .0
                .lock()
                .map_err(|_| AppError::internal("kiosk state poisoned"))? = Some((pos, size));
        }

        window
            .set_decorations(false)
            .map_err(|e| err("set_decorations", e))?;
        window
            .set_always_on_top(true)
            .map_err(|e| err("set_always_on_top", e))?;
        window
            .set_position(*monitor.position())
            .map_err(|e| err("set_position", e))?;
        window
            .set_size(*monitor.size())
            .map_err(|e| err("set_size", e))?;
    } else {
        window
            .set_always_on_top(false)
            .map_err(|e| err("set_always_on_top", e))?;
        window
            .set_decorations(true)
            .map_err(|e| err("set_decorations", e))?;
        let previous = saved
            .0
            .lock()
            .map_err(|_| AppError::internal("kiosk state poisoned"))?
            .take();
        if let Some((pos, size)) = previous {
            window.set_size(size).map_err(|e| err("set_size", e))?;
            window
                .set_position(pos)
                .map_err(|e| err("set_position", e))?;
        }
    }
    Ok(())
}

/// Open the bundled user guide for the given language in the OS PDF viewer.
///
/// Done in Rust rather than via the opener plugin's JS API: the Rust call is not
/// gated by the webview's ACL scope, and a failure (resource missing on a
/// stripped install, no PDF handler registered) comes back as a real error the
/// UI can show instead of a silently swallowed promise rejection.
#[tauri::command]
fn open_user_guide(app: tauri::AppHandle, lang: String) -> Result<(), AppError> {
    let file = if lang == "en" {
        "guide/user-guide-en.pdf"
    } else {
        "guide/user-guide-sv.pdf"
    };
    let path = app
        .path()
        .resolve(file, tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::internal(format!("cannot resolve {file}: {e}")))?;
    if !path.exists() {
        return Err(AppError::internal(format!(
            "user guide not found at {}",
            path.display()
        )));
    }
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::internal(format!("cannot open {}: {e}", path.display())))
}

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

/// Encrypt a local backup and upload it to S3, then apply remote retention.
///
/// The `Err` case here means the upload itself failed. A retention failure
/// (e.g. the LIST call) does NOT fail this function — it comes back as
/// `Ok((None, Some(message)))` so callers never mislabel a retention problem
/// as an upload problem (the two used to share one "[backup] S3 upload
/// failed" log line).
async fn upload_encrypted(
    path: &std::path::Path,
    settings: &settings::Settings,
) -> Result<(Option<s3::RetentionSummary>, Option<String>), AppError> {
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

    match s3::retention_remote(settings).await {
        Ok(summary) => Ok((Some(summary), None)),
        Err(e) => Ok((None, Some(e.to_string()))),
    }
}

/// Test S3 connectivity using the settings passed from the form (no DB read required).
#[tauri::command]
async fn test_s3_connection(input: settings::Settings) -> Result<String, AppError> {
    s3::test_connection(&input).await
}

/// Take an immediate local snapshot, then (if S3 is configured) upload it and
/// apply remote retention before returning — the caller's toast is the only
/// production-visible channel for the remote outcome (see
/// `log_backup_upload_outcome`), so this can no longer be fire-and-forget.
/// A remote failure is reported in the result, not as a command error: a good
/// local snapshot must not become a red toast because S3 failed.
#[tauri::command]
async fn backup_now(
    db: tauri::State<'_, db::Db>,
    backup_dir: tauri::State<'_, backup::BackupDir>,
) -> Result<BackupNowResult, AppError> {
    // Same lock-then-drop-before-await scoping as list_backups: no
    // MutexGuard held across the upload below. retention_local is fs-only
    // (no `conn` needed) and runs after the lock is dropped, same as before.
    let (path, settings) = {
        let conn = db
            .0
            .lock()
            .map_err(|_| AppError::internal("db lock poisoned"))?;
        let path = backup::snapshot_local(&conn, &backup_dir.0)?;
        let settings = settings::get_settings_inner(&conn)?;
        (path, settings)
    };
    backup::retention_local(&backup_dir.0)?;
    let filename = path.file_name().unwrap().to_string_lossy().into_owned();

    let (mut remote, mut remote_error) = (None, None);
    if settings.s3_endpoint.is_some() && settings.backup_passphrase.is_some() {
        let outcome = upload_encrypted(&path, &settings).await;
        log_backup_upload_outcome(&outcome);
        match outcome {
            Ok((summary, err)) => {
                remote = summary;
                remote_error = err;
            }
            Err(e) => remote_error = Some(e.to_string()),
        }
    }

    Ok(BackupNowResult {
        filename,
        remote,
        remote_error,
    })
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            app.manage(WindowedGeometry::default());

            // Production kiosk: maximize and grab focus once at startup. In dev the
            // window stays small and unfocused (config `focus: false`) so the
            // rebuild-driven relaunch on each Rust change doesn't steal focus.
            #[cfg(not(debug_assertions))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.maximize();
                let _ = win.set_focus();
            }

            // Timer thread: snapshot every hour unconditionally.
            // VACUUM INTO on a small SQLite is near-instant.
            let app_timer = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(3600));

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

                    if let Err(e) = backup::retention_local(&bdir.0) {
                        eprintln!("[backup] local retention failed: {e}");
                    }

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
                                log_backup_upload_outcome(&upload_encrypted(&path, &settings).await);
                            }
                        });
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_health,
            open_user_guide,
            set_kiosk,
            seed::wipe_database,
            seed::wipe_transactions,
            commands::list_users,
            commands::list_operators,
            commands::get_user,
            commands::create_user,
            commands::update_user,
            commands::set_user_active,
            commands::set_preferred_weapon,
            commands::upsert_guest,
            commands::promote_guest,
            commands::has_admin,
            commands::list_weapons,
            commands::get_weapon,
            commands::next_weapon_display_id,
            commands::create_weapon,
            commands::update_weapon,
            commands::set_weapon_active,
            commands::set_weapon_tags,
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
            stats::stats_summary,
            stats::stats_loans_buckets,
            stats::stats_weapon_usage,
            stats::stats_member_activity,
            stats::maintenance_stale_assignments,
            stats::maintenance_never_borrowed,
            stats::maintenance_tagged_weapons,
            stats::maintenance_guests,
            stats::export_csv,
            service::add_service,
            service::list_weapon_service,
            import::import_list_sheets,
            import::import_preview,
            import::import_commit,
            import::import_export_unmatched,
            member_import::member_import_preview,
            member_import::member_import_commit,
            settings::get_settings,
            settings::update_settings,
            test_s3_connection,
            backup_now,
            list_backups,
            restore_backup,
            background::set_background,
            background::get_background,
            background::clear_background,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let bdir_path = app_handle.state::<backup::BackupDir>().0.clone();
                {
                    let db = app_handle.state::<db::Db>();
                    if let Ok(conn) = db.0.lock() {
                        // Local only — never uploaded to S3 (see design spec B).
                        if let Err(e) = backup::snapshot_local(&conn, &bdir_path) {
                            eprintln!("[backup] exit snapshot failed: {e}");
                        }
                        if let Err(e) = backup::retention_local(&bdir_path) {
                            eprintln!("[backup] exit local retention failed: {e}");
                        }
                    };
                }
            }
        });
}
