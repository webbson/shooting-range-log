//! SQLite connection + migrations.
//!
//! The connection is opened once at startup, stored as Tauri managed state
//! (`Db`), and shared via a `Mutex` (single-user desktop app). Pending
//! migrations are applied automatically on launch, so the database upgrades
//! itself after an app update with no manual SQL on the laptop.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Managed Tauri state wrapping the SQLite connection.
pub struct Db(pub Mutex<Connection>);

const APP_IDENTIFIER: &str = "com.aura.shootingrangelog";
const DB_FILENAME: &str = "shooting-range-log.sqlite";

/// Full schema (migration 0001).
///
/// Identity model: `uid` is the hidden permanent PK / only FK target;
/// `display_id` is the movable physical tag, unique only among **active** rows
/// (partial indexes below) so a tag can be reassigned once its holder is retired.
/// Log rows store only uids; identity is resolved live by uid at read time (no
/// snapshots). Money is whole kronor (`amount_kr`). Timestamps are RFC3339 UTC.
const SCHEMA_V1: &str = r#"
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('app', 'shooting-range-log');

CREATE TABLE users (
  uid           INTEGER PRIMARY KEY,
  display_id    TEXT,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  ssn           TEXT,
  is_staff      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_display_active
  ON users(display_id) WHERE active = 1 AND display_id IS NOT NULL;

CREATE TABLE weapons (
  uid             INTEGER PRIMARY KEY,
  display_id      TEXT,
  brand           TEXT,
  model           TEXT,
  serial          TEXT,
  caliber         TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  inactive_reason TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_weapons_display_active
  ON weapons(display_id) WHERE active = 1 AND display_id IS NOT NULL;
CREATE UNIQUE INDEX idx_weapons_serial
  ON weapons(serial) WHERE serial IS NOT NULL;

CREATE TABLE checkouts (
  id                       INTEGER PRIMARY KEY,
  weapon_uid               INTEGER NOT NULL REFERENCES weapons(uid),
  user_uid                 INTEGER NOT NULL REFERENCES users(uid),
  operator_out_uid         INTEGER NOT NULL REFERENCES users(uid),
  checked_out_at           TEXT NOT NULL,
  operator_in_uid          INTEGER REFERENCES users(uid),
  checked_in_at            TEXT,
  notes                    TEXT
);
CREATE INDEX idx_checkouts_weapon ON checkouts(weapon_uid, checked_out_at);
CREATE INDEX idx_checkouts_user ON checkouts(user_uid, checked_out_at);
CREATE INDEX idx_checkouts_open ON checkouts(weapon_uid) WHERE checked_in_at IS NULL;

CREATE TABLE weapon_service_log (
  id                      INTEGER PRIMARY KEY,
  weapon_uid              INTEGER NOT NULL REFERENCES weapons(uid),
  operator_uid            INTEGER NOT NULL REFERENCES users(uid),
  serviced_at             TEXT NOT NULL,
  description             TEXT NOT NULL,
  notes                   TEXT
);
CREATE INDEX idx_service_weapon ON weapon_service_log(weapon_uid, serviced_at);

CREATE TABLE debts (
  id                   INTEGER PRIMARY KEY,
  user_uid             INTEGER NOT NULL REFERENCES users(uid),
  operator_uid         INTEGER NOT NULL REFERENCES users(uid),
  amount_kr            INTEGER NOT NULL,
  reason               TEXT,
  created_at           TEXT NOT NULL,
  settled_at           TEXT,
  settled_operator_uid INTEGER REFERENCES users(uid),
  checkout_id          INTEGER REFERENCES checkouts(id)
);
CREATE INDEX idx_debts_user_open ON debts(user_uid) WHERE settled_at IS NULL;
"#;

/// Settings table (migration 0002).
const SCHEMA_V2: &str = r#"
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"#;

/// Ordered list of migrations. Once a migration has shipped to a real install,
/// never edit it — append a new one. `to_latest` applies any not yet recorded in
/// `PRAGMA user_version`.
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // 0001 — full domain schema.
        M::up(SCHEMA_V1),
        // 0002 — app settings key/value store.
        M::up(SCHEMA_V2),
    ])
}

/// Open the database at `path` (creating its parent dir), enable WAL + foreign
/// keys, and migrate to the latest schema. Shared by the app (`init`) and the dev
/// seeding CLI so schema/pragmas can never drift between them.
pub fn open_migrated(path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::internal(format!("create data dir: {e}")))?;
    }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations().to_latest(&mut conn)?;
    Ok(conn)
}

/// Open the database in the OS app-data dir (Tauri's canonical resolver) and
/// migrate it. This is the path the running app uses.
pub fn init(app: &AppHandle) -> Result<Db, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("app_data_dir: {e}")))?;
    let path = dir.join(DB_FILENAME);
    Ok(Db(Mutex::new(open_migrated(&path)?)))
}

/// DB path for the dev seeding CLI (`npm run seed`), which has no Tauri
/// `AppHandle`. Mirrors Tauri v2 `app_data_dir()` = `dirs::data_dir()` + the
/// bundle identifier (verified against Tauri's resolution), so the CLI writes the
/// exact file the dev app reads. Dev-only; the app itself uses `init` above.
pub fn dev_db_path() -> Result<PathBuf, AppError> {
    let base = dirs::data_dir().ok_or_else(|| AppError::internal("no OS data dir"))?;
    Ok(base.join(APP_IDENTIFIER).join(DB_FILENAME))
}

/// In-memory, fully-migrated connection for unit tests (foreign keys enforced).
#[cfg(test)]
pub fn migrated_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations().to_latest(&mut conn).unwrap();
    conn
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
        assert_eq!(v, 2, "two migrations applied");
    }

    #[test]
    fn migrations_validate() {
        // Catches malformed SQL / non-monotonic migrations at test time.
        migrations().validate().unwrap();
    }
}
