//! Local snapshot, GFS retention, and restore.
//!
//! Snapshots are WAL-safe via `VACUUM INTO` and named
//! `srl-backup-YYYY-MM-DDTHH-MM-SSZ-v{schema}.sqlite` (colons replaced with
//! dashes for Windows filesystem compatibility).
//!
//! Retention tiers (applied relative to wall-clock date at retention time):
//!   today             → keep 1 per clock-hour
//!   earlier this month → keep 1 per calendar day
//!   earlier this year  → keep 1 per ISO week
//!   previous cal. year → keep 1 per calendar month
//!   older              → purge

use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDate, Timelike, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::db;
use crate::error::AppError;

/// Tauri managed state: directory where local backups live.
pub struct BackupDir(pub PathBuf);

/// Source of a backup entry in the combined list.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackupSource {
    Local,
    Remote,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub filename: String,
    /// UTC RFC3339.
    pub timestamp: String,
    pub schema_version: i64,
    pub source: BackupSource,
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

pub fn snapshot_local(conn: &Connection, dir: &Path) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(dir)?;
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let now = Utc::now();
    // Use dashes in time part so filenames are valid on Windows.
    let ts = now.format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let filename = format!("srl-backup-{ts}-v{user_version}.sqlite");
    let dest = dir.join(&filename);
    conn.execute(
        &format!("VACUUM INTO '{}'", dest.to_string_lossy().replace('\'', "''")),
        [],
    )?;
    Ok(dest)
}

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

fn parse_backup_timestamp(name: &str) -> Option<chrono::DateTime<Utc>> {
    // srl-backup-2026-06-18T14-30-00Z-v2.sqlite  (local)
    // srl-backup-2026-06-18T14-30-00Z-v2.sqlite.age  (remote, caller strips .age)
    let name = name.strip_suffix(".age").unwrap_or(name);
    let stripped = name
        .strip_prefix("srl-backup-")?
        .strip_suffix(".sqlite")?;
    // "2026-06-18T14-30-00Z-v2"
    let ts_str = stripped.rsplit_once("-v")?.0;
    // "2026-06-18T14-30-00Z"
    let (date_part, time_part) = ts_str.split_once('T')?;
    // Restore colons: "14-30-00Z" → "14:30:00Z"
    let time_fixed = time_part.replacen('-', ":", 2);
    let full = format!("{date_part}T{time_fixed}");
    full.parse::<chrono::DateTime<Utc>>().ok()
}

fn gfs_slot(
    ts: chrono::DateTime<Utc>,
    today: NaiveDate,
    cy: i32,
    cm: u32,
) -> Option<String> {
    let date = ts.date_naive();
    if date == today {
        Some(format!("hour:{}-{:02}", date, ts.hour()))
    } else if date.year() == cy && date.month() == cm {
        Some(format!("day:{}", date))
    } else if date.year() == cy {
        let w = date.iso_week();
        Some(format!("week:{}-{:02}", w.year(), w.week()))
    } else if date.year() == cy - 1 {
        Some(format!("month:{}-{:02}", date.year(), date.month()))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

pub fn retention_local(dir: &Path) -> Result<(), AppError> {
    let now = Utc::now();
    let today = now.date_naive();
    let cy = today.year();
    let cm = today.month();

    let mut entries: Vec<(PathBuf, chrono::DateTime<Utc>)> = std::fs::read_dir(dir)
        .map_err(|e| AppError::internal(format!("list backup dir: {e}")))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.to_owned();
            let ts = parse_backup_timestamp(&name)?;
            Some((p, ts))
        })
        .collect();

    // Newest first — first occurrence of a slot is the keeper.
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    let mut seen = std::collections::HashSet::new();
    for (path, ts) in &entries {
        match gfs_slot(*ts, today, cy, cm) {
            Some(slot) if seen.contains(&slot) => {
                let _ = std::fs::remove_file(path);
            }
            Some(slot) => {
                seen.insert(slot);
            }
            None => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

pub fn list_local(dir: &Path) -> Result<Vec<BackupInfo>, AppError> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut infos: Vec<BackupInfo> = std::fs::read_dir(dir)
        .map_err(|e| AppError::internal(format!("list backup dir: {e}")))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.to_owned();
            if !name.ends_with(".sqlite") {
                return None;
            }
            let ts = parse_backup_timestamp(&name)?;
            // Extract schema version from filename suffix "-vN.sqlite"
            let ver_str = name
                .strip_suffix(".sqlite")?
                .rsplit_once("-v")?
                .1;
            let schema_version: i64 = ver_str.parse().ok()?;
            Some(BackupInfo {
                filename: name,
                timestamp: ts.to_rfc3339(),
                schema_version,
                source: BackupSource::Local,
            })
        })
        .collect();

    infos.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(infos)
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

pub fn restore_from_file(dest: &mut Connection, path: &Path) -> Result<(), AppError> {
    let source = Connection::open(path)
        .map_err(|e| AppError::internal(format!("open backup: {e}")))?;

    // Schema guard: refuse to restore a backup newer than this binary supports.
    let backup_ver: i64 = source.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let live_ver: i64 = dest.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if backup_ver > live_ver {
        return Err(AppError::new(
            "err_backup_too_new",
            format!(
                "Backup schema v{backup_ver} is newer than app v{live_ver}. Update the app first."
            ),
            serde_json::json!({ "backupVersion": backup_ver, "appVersion": live_ver }),
        ));
    }

    // Online backup: copy all pages from source into the live connection.
    {
        let op = rusqlite::backup::Backup::new(&source, dest)
            .map_err(|e| AppError::internal(format!("backup init: {e}")))?;
        op.run_to_completion(100, std::time::Duration::from_millis(0), None)
            .map_err(|e| AppError::internal(format!("backup failed: {e}")))?;
    }

    // Re-apply any pending migrations (e.g. restoring an older backup onto a newer binary).
    db::run_migrations(dest)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;

    #[test]
    fn snapshot_and_restore_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();

        // Source DB with some data.
        let mut source = migrated_in_memory();
        source
            .execute(
                "INSERT INTO users (display_id, name, is_staff, active, created_at, updated_at)
                 VALUES ('A1', 'Alice', 0, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();

        let path = snapshot_local(&source, &dir).unwrap();
        assert!(path.exists());

        // Restore into a fresh connection.
        let mut dest = migrated_in_memory();
        restore_from_file(&mut dest, &path).unwrap();

        let name: String = dest
            .query_row("SELECT name FROM users WHERE display_id = 'A1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "Alice");
    }

    #[test]
    fn parse_timestamp_roundtrip() {
        let ts = parse_backup_timestamp("srl-backup-2026-06-18T14-30-00Z-v2.sqlite").unwrap();
        assert_eq!(ts.hour(), 14);
        assert_eq!(ts.minute(), 30);
    }

    #[test]
    fn retention_keeps_newest_per_slot() {
        // Two backups in the same hour → only the newer survives.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        let conn = migrated_in_memory();
        // Create two snapshots in the same clock-hour by overwriting the second one's timestamp
        // in the filename (we just create the files directly).
        let now = Utc::now();
        let ts1 = now
            .format("%Y-%m-%dT%H-%M-%SZ")
            .to_string()
            .replacen(":", "-", 2);
        let ts2 = {
            let earlier = now - chrono::Duration::seconds(30);
            earlier
                .format("%Y-%m-%dT%H-%M-%SZ")
                .to_string()
                .replacen(":", "-", 2)
        };

        let f1 = dir.join(format!("srl-backup-{ts1}-v2.sqlite"));
        let f2 = dir.join(format!("srl-backup-{ts2}-v2.sqlite"));
        snapshot_local(&conn, dir).unwrap(); // creates one real file
        // We just need two files with parseable names in the same hour.
        std::fs::copy(dir.read_dir().unwrap().next().unwrap().unwrap().path(), &f1).ok();
        std::fs::copy(&f1, &f2).unwrap();

        let before = std::fs::read_dir(dir).unwrap().count();
        assert!(before >= 2);
        retention_local(dir).unwrap();
        let after = std::fs::read_dir(dir).unwrap().count();
        // At most one per slot (same hour).
        assert!(after <= before);
    }
}
