//! SQLite connection + migrations.
//!
//! The connection is opened once at startup, stored as Tauri managed state
//! (`Db`), and shared via a `Mutex` (single-user desktop app). Pending
//! migrations are applied automatically on launch, so the database upgrades
//! itself after an app update with no manual SQL on the laptop.

use std::sync::Mutex;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Managed Tauri state wrapping the SQLite connection.
pub struct Db(pub Mutex<Connection>);

/// Ordered list of migrations. Never edit a released migration — append a new
/// one. `to_latest` applies any not yet recorded in `PRAGMA user_version`.
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // 0001 — bootstrap. Full domain schema arrives in M1.
        M::up(
            "CREATE TABLE app_meta (\
                 key   TEXT PRIMARY KEY,\
                 value TEXT NOT NULL\
             );\
             INSERT INTO app_meta (key, value) VALUES ('app', 'shooting-range-log');",
        ),
    ])
}

/// Open the database in the OS app-data dir, enable WAL + foreign keys, and
/// migrate to the latest schema.
pub fn init(app: &AppHandle) -> Result<Db, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Other(format!("create data dir: {e}")))?;

    let path = dir.join("shooting-range-log.sqlite");
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    migrations().to_latest(&mut conn)?;

    Ok(Db(Mutex::new(conn)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_to_in_memory_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 1, "one migration applied");
    }

    #[test]
    fn migrations_validate() {
        // Catches malformed SQL / non-monotonic migrations at test time.
        migrations().validate().unwrap();
    }
}
