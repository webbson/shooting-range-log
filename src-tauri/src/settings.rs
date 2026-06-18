//! App settings persisted to the `settings` key/value table (migration 0002).
//!
//! Every field maps to one row. Missing rows (fresh install) default to `None`;
//! the frontend applies sensible UI defaults (interval=60, keep=10).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

/// All configurable settings. Serialised camelCase so the frontend can use its
/// native naming conventions.
///
/// Interval and retention are fixed by the app (10-min snapshots, GFS tiers) and
/// are not exposed here.
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub s3_endpoint: Option<String>,
    pub s3_region: Option<String>,
    pub s3_bucket: Option<String>,
    pub s3_prefix: Option<String>,
    pub s3_access_key_id: Option<String>,
    pub s3_secret_access_key: Option<String>,
    pub backup_passphrase: Option<String>,
}

fn lock<'a>(
    db: &'a State<'_, Db>,
) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

pub(crate) fn get_settings_inner(conn: &Connection) -> Result<Settings, AppError> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })?;

    let mut s = Settings::default();
    for row in rows {
        let (key, value) = row?;
        match key.as_str() {
            "s3_endpoint" => s.s3_endpoint = value,
            "s3_region" => s.s3_region = value,
            "s3_bucket" => s.s3_bucket = value,
            "s3_prefix" => s.s3_prefix = value,
            "s3_access_key_id" => s.s3_access_key_id = value,
            "s3_secret_access_key" => s.s3_secret_access_key = value,
            "backup_passphrase" => s.backup_passphrase = value,
            _ => {}
        }
    }
    Ok(s)
}

pub(crate) fn set_settings_inner(conn: &Connection, input: Settings) -> Result<(), AppError> {
    // Upsert each field. NULL values clear the stored setting back to "unset".
    let pairs: &[(&str, Option<String>)] = &[
        ("s3_endpoint", input.s3_endpoint),
        ("s3_region", input.s3_region),
        ("s3_bucket", input.s3_bucket),
        ("s3_prefix", input.s3_prefix),
        ("s3_access_key_id", input.s3_access_key_id),
        ("s3_secret_access_key", input.s3_secret_access_key),
        ("backup_passphrase", input.backup_passphrase),
    ];
    for (key, value) in pairs {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(db: State<Db>) -> Result<Settings, AppError> {
    let conn = lock(&db)?;
    get_settings_inner(&conn)
}

#[tauri::command]
pub fn update_settings(db: State<Db>, input: Settings) -> Result<(), AppError> {
    let conn = lock(&db)?;
    set_settings_inner(&conn, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;

    #[test]
    fn settings_round_trip() {
        let conn = migrated_in_memory();
        let empty = get_settings_inner(&conn).unwrap();
        assert!(empty.s3_endpoint.is_none());

        let input = Settings {
            s3_endpoint: Some("https://s3.example.com".into()),
            s3_bucket: Some("my-bucket".into()),
            backup_passphrase: Some("hunter2".into()),
            ..Default::default()
        };
        set_settings_inner(&conn, input).unwrap();

        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.s3_endpoint.as_deref(), Some("https://s3.example.com"));
        assert_eq!(loaded.s3_bucket.as_deref(), Some("my-bucket"));
        assert_eq!(loaded.backup_passphrase.as_deref(), Some("hunter2"));
        assert!(loaded.s3_region.is_none());
    }

    #[test]
    fn settings_upsert_overwrites() {
        let conn = migrated_in_memory();
        let first = Settings {
            s3_endpoint: Some("https://old.example.com".into()),
            ..Default::default()
        };
        set_settings_inner(&conn, first).unwrap();

        let second = Settings {
            s3_endpoint: Some("https://new.example.com".into()),
            ..Default::default()
        };
        set_settings_inner(&conn, second).unwrap();

        let loaded = get_settings_inner(&conn).unwrap();
        assert_eq!(loaded.s3_endpoint.as_deref(), Some("https://new.example.com"));
    }
}
