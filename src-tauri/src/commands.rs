//! Tauri commands for user & weapon CRUD, plus the display_id reassignment rule.
//!
//! Logic lives in inner `*_inner`-style fns that take `&Connection` so they are
//! unit-testable without a Tauri runtime; thin `#[tauri::command]` wrappers lock
//! the shared connection and delegate.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use crate::db::Db;
use crate::error::AppError;
use crate::models::{
    NewUser, NewWeapon, UpdateUser, UpdateWeapon, User, Weapon, USER_COLS, WEAPON_COLS,
};

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Trim; treat empty/whitespace-only as absent (NULL).
fn norm(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn require_name(name: String) -> Result<String, AppError> {
    let n = name.trim().to_string();
    if n.is_empty() {
        return Err(AppError::name_required());
    }
    Ok(n)
}

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

/// A display_id may belong to at most one ACTIVE row per table, so a retired
/// entity's tag can be reassigned. `table` is an internal constant, never input.
fn ensure_display_id_free(
    conn: &Connection,
    table: &str,
    display_id: &Option<String>,
    exclude_uid: Option<i64>,
) -> Result<(), AppError> {
    let Some(did) = display_id else { return Ok(()) };
    let sql =
        format!("SELECT 1 FROM {table} WHERE display_id = ?1 AND active = 1 AND uid <> ?2 LIMIT 1");
    let taken = conn
        .query_row(&sql, params![did, exclude_uid.unwrap_or(-1)], |_| Ok(()))
        .optional()?
        .is_some();
    if taken {
        return Err(AppError::display_id_taken(did));
    }
    Ok(())
}

/// Serial numbers are globally unique (durable legal identity).
fn ensure_serial_free(
    conn: &Connection,
    serial: &Option<String>,
    exclude_uid: Option<i64>,
) -> Result<(), AppError> {
    let Some(s) = serial else { return Ok(()) };
    let taken = conn
        .query_row(
            "SELECT 1 FROM weapons WHERE serial = ?1 AND uid <> ?2 LIMIT 1",
            params![s, exclude_uid.unwrap_or(-1)],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if taken {
        return Err(AppError::serial_taken(s));
    }
    Ok(())
}

// ---------- Users (inner) ----------

fn users_list(conn: &Connection) -> Result<Vec<User>, AppError> {
    let sql = format!("SELECT {USER_COLS} FROM users ORDER BY active DESC, name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], User::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn operators_list(conn: &Connection) -> Result<Vec<User>, AppError> {
    let sql = format!(
        "SELECT {USER_COLS} FROM users WHERE is_staff = 1 AND active = 1 ORDER BY name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], User::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn user_get(conn: &Connection, uid: i64) -> Result<Option<User>, AppError> {
    let sql = format!("SELECT {USER_COLS} FROM users WHERE uid = ?1");
    Ok(conn
        .query_row(&sql, params![uid], |r| User::from_row(r))
        .optional()?)
}

fn user_require(conn: &Connection, uid: i64) -> Result<User, AppError> {
    user_get(conn, uid)?.ok_or_else(|| AppError::user_not_found(uid))
}

pub(crate) fn user_create(conn: &Connection, input: NewUser) -> Result<User, AppError> {
    let display_id = norm(input.display_id);
    let name = require_name(input.name)?;
    // display_id is optional for members; enforce uniqueness only when one is given.
    ensure_display_id_free(conn, "users", &display_id, None)?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO users
           (display_id, name, email, phone, address, ssn, is_staff, is_admin, active, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?10)",
        params![
            display_id,
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            input.is_admin,
            norm(input.notes),
            now,
        ],
    )?;
    user_require(conn, conn.last_insert_rowid())
}

fn user_update(conn: &Connection, input: UpdateUser) -> Result<User, AppError> {
    let current = user_require(conn, input.uid)?;
    let display_id = norm(input.display_id);
    let name = require_name(input.name)?;
    // display_id is optional; enforce uniqueness only when one is given.
    ensure_display_id_free(conn, "users", &display_id, Some(input.uid))?;
    conn.execute(
        "UPDATE users SET
           display_id = ?2, name = ?3, email = ?4, phone = ?5,
           address = ?6, ssn = ?7, is_staff = ?8, is_admin = ?9, notes = ?10, updated_at = ?11
         WHERE uid = ?1",
        params![
            input.uid,
            display_id,
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            input.is_admin,
            norm(input.notes),
            now_utc(),
        ],
    )?;
    user_require(conn, input.uid)
}

pub(crate) fn user_set_active(
    conn: &Connection,
    uid: i64,
    active: bool,
    clear_display_id: bool,
) -> Result<User, AppError> {
    let current = user_require(conn, uid)?;
    if active {
        // Reactivating: if a tag is retained, it must still be free.
        ensure_display_id_free(conn, "users", &current.display_id, Some(uid))?;
        conn.execute(
            "UPDATE users SET active = 1, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    } else if clear_display_id {
        // Free the physical tag so it can be reassigned to another member.
        // Deactivation also frees the member's favorite weapon for others.
        conn.execute(
            "UPDATE users SET active = 0, display_id = NULL, preferred_weapon_uid = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    } else {
        conn.execute(
            "UPDATE users SET active = 0, preferred_weapon_uid = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    }
    user_require(conn, uid)
}

/// Set (or clear, with None) a member's preferred weapon. A weapon can be the
/// preferred weapon of at most one member — checked here first so the error can
/// name the competing member; the partial unique index is the DB backstop.
pub(crate) fn user_set_preferred_weapon(
    conn: &Connection,
    user_uid: i64,
    weapon_uid: Option<i64>,
) -> Result<User, AppError> {
    user_require(conn, user_uid)?;
    if let Some(wuid) = weapon_uid {
        let w = weapon_require(conn, wuid)?;
        if !w.active {
            return Err(AppError::weapon_inactive());
        }
        let other: Option<String> = conn
            .query_row(
                "SELECT name FROM users WHERE preferred_weapon_uid = ?1 AND uid <> ?2",
                params![wuid, user_uid],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(name) = other {
            return Err(AppError::weapon_already_preferred(&name));
        }
    }
    conn.execute(
        "UPDATE users SET preferred_weapon_uid = ?2, updated_at = ?3 WHERE uid = ?1",
        params![user_uid, weapon_uid, now_utc()],
    )?;
    user_require(conn, user_uid)
}

/// Normalize a personnummer to canonical `YYYYMMDD-XXXX`.
/// Accepts 10 or 12 digits with any spacing/dashes; 10-digit century is
/// inferred (20xx unless that lands in the future, then 19xx). Day 61–91 =
/// samordningsnummer. Stored values are already canonical — all guest writes
/// pass through here — so only the input needs normalizing.
fn normalize_ssn(raw: &str) -> Result<String, AppError> {
    use chrono::Datelike;
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let full = match digits.len() {
        12 => digits,
        10 => {
            let yy: i32 = digits[0..2].parse().unwrap();
            let century = if 2000 + yy > chrono::Utc::now().year() { 1900 } else { 2000 };
            format!("{}{}", century + yy, &digits[2..])
        }
        _ => return Err(AppError::ssn_invalid()),
    };
    let month: u32 = full[4..6].parse().unwrap();
    let day: u32 = full[6..8].parse().unwrap();
    if !(1..=12).contains(&month) || !((1..=31).contains(&day) || (61..=91).contains(&day)) {
        return Err(AppError::ssn_invalid());
    }
    Ok(format!("{}-{}", &full[0..8], &full[8..12]))
}

/// Guest checkout entry: find an active user by SSN or create a guest.
/// Active guest with this SSN → returned as-is (name is not overwritten).
/// Active member with this SSN → error (use the normal member flow).
pub(crate) fn user_upsert_guest(
    conn: &Connection,
    name: String,
    ssn: String,
) -> Result<User, AppError> {
    let ssn = norm(Some(ssn)).ok_or_else(AppError::ssn_required)?;
    let ssn = normalize_ssn(&ssn)?;
    let name = require_name(name)?;
    let sql = format!("SELECT {USER_COLS} FROM users WHERE ssn = ?1 AND active = 1");
    let existing = conn
        .query_row(&sql, params![ssn], |r| User::from_row(r))
        .optional()?;
    if let Some(u) = existing {
        if u.is_guest {
            return Ok(u);
        }
        return Err(AppError::ssn_belongs_to_member(&u.name));
    }
    let now = now_utc();
    conn.execute(
        "INSERT INTO users (name, ssn, is_guest, active, created_at, updated_at)
         VALUES (?1, ?2, 1, 1, ?3, ?3)",
        params![name, ssn, now],
    )?;
    user_require(conn, conn.last_insert_rowid())
}

/// Admin-only in the UI: turn a guest into a normal member.
pub(crate) fn user_promote_guest(conn: &Connection, uid: i64) -> Result<User, AppError> {
    let u = user_require(conn, uid)?;
    if !u.is_guest {
        return Err(AppError::not_a_guest());
    }
    conn.execute(
        "UPDATE users SET is_guest = 0, updated_at = ?2 WHERE uid = ?1",
        params![uid, now_utc()],
    )?;
    user_require(conn, uid)
}

/// Bootstrap: when no active admin exists, the frontend disables admin gating.
pub(crate) fn admin_exists(conn: &Connection) -> Result<bool, AppError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE is_admin = 1 AND active = 1",
        [],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

// ---------- Weapons (inner) ----------

fn weapons_list(conn: &Connection) -> Result<Vec<Weapon>, AppError> {
    let sql = format!(
        "SELECT {WEAPON_COLS} FROM weapons ORDER BY active DESC, display_id COLLATE NOCASE, brand COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], Weapon::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Smallest positive integer not held as a tag in `table` — by an active row, or
/// an inactive row that has not been cleared (a retained tag is still physically
/// in use). Non-numeric tags are ignored. `table` is an internal constant.
fn next_free_display_id(conn: &Connection, table: &str) -> Result<String, AppError> {
    let sql = format!("SELECT display_id FROM {table} WHERE display_id IS NOT NULL");
    let mut stmt = conn.prepare(&sql)?;
    let taken: HashSet<i64> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect();
    let mut n = 1i64;
    while taken.contains(&n) {
        n += 1;
    }
    Ok(n.to_string())
}

pub(crate) fn next_free_weapon_display_id(conn: &Connection) -> Result<String, AppError> {
    next_free_display_id(conn, "weapons")
}

pub(crate) fn weapon_get(conn: &Connection, uid: i64) -> Result<Option<Weapon>, AppError> {
    let sql = format!("SELECT {WEAPON_COLS} FROM weapons WHERE uid = ?1");
    Ok(conn
        .query_row(&sql, params![uid], |r| Weapon::from_row(r))
        .optional()?)
}

fn weapon_require(conn: &Connection, uid: i64) -> Result<Weapon, AppError> {
    weapon_get(conn, uid)?.ok_or_else(|| AppError::weapon_not_found(uid))
}

pub(crate) fn weapon_create(conn: &Connection, input: NewWeapon) -> Result<Weapon, AppError> {
    let display_id = norm(input.display_id);
    let serial = norm(input.serial);
    // New weapons are active; an active weapon must carry a tag.
    if display_id.is_none() {
        return Err(AppError::display_id_required());
    }
    ensure_display_id_free(conn, "weapons", &display_id, None)?;
    ensure_serial_free(conn, &serial, None)?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO weapons
           (display_id, brand, model, serial, caliber, active, inactive_reason, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,1,NULL,?6,?7,?7)",
        params![
            display_id,
            norm(input.brand),
            norm(input.model),
            serial,
            norm(input.caliber),
            norm(input.notes),
            now,
        ],
    )?;
    weapon_require(conn, conn.last_insert_rowid())
}

fn weapon_update(conn: &Connection, input: UpdateWeapon) -> Result<Weapon, AppError> {
    let current = weapon_require(conn, input.uid)?;
    let display_id = norm(input.display_id);
    let serial = norm(input.serial);
    // An active weapon must keep a tag; inactive weapons may have it cleared.
    if current.active && display_id.is_none() {
        return Err(AppError::display_id_required());
    }
    ensure_display_id_free(conn, "weapons", &display_id, Some(input.uid))?;
    ensure_serial_free(conn, &serial, Some(input.uid))?;
    conn.execute(
        "UPDATE weapons SET
           display_id = ?2, brand = ?3, model = ?4, serial = ?5, caliber = ?6, notes = ?7, updated_at = ?8
         WHERE uid = ?1",
        params![
            input.uid,
            display_id,
            norm(input.brand),
            norm(input.model),
            serial,
            norm(input.caliber),
            norm(input.notes),
            now_utc(),
        ],
    )?;
    weapon_require(conn, input.uid)
}

pub(crate) fn weapon_set_active(
    conn: &Connection,
    uid: i64,
    active: bool,
    inactive_reason: Option<String>,
    clear_display_id: bool,
) -> Result<Weapon, AppError> {
    let current = weapon_require(conn, uid)?;
    if active {
        // Reactivating: an active weapon must carry a tag, still free.
        if current.display_id.is_none() {
            return Err(AppError::display_id_required());
        }
        ensure_display_id_free(conn, "weapons", &current.display_id, Some(uid))?;
        ensure_serial_free(conn, &current.serial, Some(uid))?;
        conn.execute(
            "UPDATE weapons SET active = 1, inactive_reason = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    } else if clear_display_id {
        // Free the physical tag so it can be reassigned to another weapon.
        conn.execute(
            "UPDATE weapons SET active = 0, display_id = NULL, inactive_reason = ?2, updated_at = ?3 WHERE uid = ?1",
            params![uid, norm(inactive_reason), now_utc()],
        )?;
    } else {
        conn.execute(
            "UPDATE weapons SET active = 0, inactive_reason = ?2, updated_at = ?3 WHERE uid = ?1",
            params![uid, norm(inactive_reason), now_utc()],
        )?;
    }
    weapon_require(conn, uid)
}

/// Set the fixed condition tags + free comment (current state, not history —
/// service history lives in weapon_service_log).
pub(crate) fn weapon_set_tags(
    conn: &Connection,
    uid: i64,
    needs_service: bool,
    broken: bool,
    missing_parts: bool,
    needs_cleaning: bool,
    comment: Option<String>,
) -> Result<Weapon, AppError> {
    weapon_require(conn, uid)?;
    conn.execute(
        "UPDATE weapons SET
           tag_needs_service = ?2, tag_broken = ?3, tag_missing_parts = ?4,
           tag_needs_cleaning = ?5, tag_comment = ?6, updated_at = ?7
         WHERE uid = ?1",
        params![uid, needs_service, broken, missing_parts, needs_cleaning, norm(comment), now_utc()],
    )?;
    weapon_require(conn, uid)
}

// ---------- Command wrappers ----------

#[tauri::command]
pub fn list_users(db: State<Db>) -> Result<Vec<User>, AppError> {
    let conn = lock(&db)?;
    users_list(&conn)
}

#[tauri::command]
pub fn list_operators(db: State<Db>) -> Result<Vec<User>, AppError> {
    let conn = lock(&db)?;
    operators_list(&conn)
}

#[tauri::command]
pub fn get_user(db: State<Db>, uid: i64) -> Result<Option<User>, AppError> {
    let conn = lock(&db)?;
    user_get(&conn, uid)
}

#[tauri::command]
pub fn create_user(db: State<Db>, input: NewUser) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_create(&conn, input)
}

#[tauri::command]
pub fn update_user(db: State<Db>, input: UpdateUser) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_update(&conn, input)
}

#[tauri::command]
pub fn set_user_active(
    db: State<Db>,
    uid: i64,
    active: bool,
    clear_display_id: bool,
) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_set_active(&conn, uid, active, clear_display_id)
}

#[tauri::command]
pub fn set_preferred_weapon(
    db: State<Db>,
    user_uid: i64,
    weapon_uid: Option<i64>,
) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_set_preferred_weapon(&conn, user_uid, weapon_uid)
}

#[tauri::command]
pub fn upsert_guest(db: State<Db>, name: String, ssn: String) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_upsert_guest(&conn, name, ssn)
}

#[tauri::command]
pub fn promote_guest(db: State<Db>, uid: i64) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_promote_guest(&conn, uid)
}

#[tauri::command]
pub fn has_admin(db: State<Db>) -> Result<bool, AppError> {
    let conn = lock(&db)?;
    admin_exists(&conn)
}

#[tauri::command]
pub fn list_weapons(db: State<Db>) -> Result<Vec<Weapon>, AppError> {
    let conn = lock(&db)?;
    weapons_list(&conn)
}

#[tauri::command]
pub fn get_weapon(db: State<Db>, uid: i64) -> Result<Option<Weapon>, AppError> {
    let conn = lock(&db)?;
    weapon_get(&conn, uid)
}

#[tauri::command]
pub fn next_weapon_display_id(db: State<Db>) -> Result<String, AppError> {
    let conn = lock(&db)?;
    next_free_weapon_display_id(&conn)
}

#[tauri::command]
pub fn create_weapon(db: State<Db>, input: NewWeapon) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_create(&conn, input)
}

#[tauri::command]
pub fn update_weapon(db: State<Db>, input: UpdateWeapon) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_update(&conn, input)
}

#[tauri::command]
pub fn set_weapon_active(
    db: State<Db>,
    uid: i64,
    active: bool,
    inactive_reason: Option<String>,
    clear_display_id: bool,
) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_set_active(&conn, uid, active, inactive_reason, clear_display_id)
}

#[tauri::command]
pub fn set_weapon_tags(
    db: State<Db>,
    weapon_uid: i64,
    needs_service: bool,
    broken: bool,
    missing_parts: bool,
    needs_cleaning: bool,
    comment: Option<String>,
) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_set_tags(&conn, weapon_uid, needs_service, broken, missing_parts, needs_cleaning, comment)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;

    fn new_user(name: &str, display_id: Option<&str>, is_staff: bool) -> NewUser {
        NewUser {
            display_id: display_id.map(String::from),
            name: name.into(),
            email: None,
            phone: None,
            address: None,
            ssn: None,
            is_staff,
            is_admin: false,
            notes: None,
        }
    }

    fn new_weapon(display_id: Option<&str>, serial: Option<&str>) -> NewWeapon {
        NewWeapon {
            display_id: display_id.map(String::from),
            brand: Some("Glock".into()),
            model: Some("17".into()),
            serial: serial.map(String::from),
            caliber: Some("9mm".into()),
            notes: None,
        }
    }

    #[test]
    fn display_id_unique_among_active() {
        let conn = migrated_in_memory();
        user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let err = user_create(&conn, new_user("Björn", Some("10"), false)).unwrap_err();
        assert!(err.to_string().contains("already in use"), "{err}");
    }

    #[test]
    fn display_id_reusable_after_retire() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        user_set_active(&conn, a.uid, false, false).unwrap();
        // Tag "10" is now free for a new active user.
        let c = user_create(&conn, new_user("Cecilia", Some("10"), false)).unwrap();
        assert_eq!(c.display_id.as_deref(), Some("10"));
    }

    #[test]
    fn reactivating_into_taken_display_id_fails() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        user_set_active(&conn, a.uid, false, false).unwrap();
        user_create(&conn, new_user("Cecilia", Some("10"), false)).unwrap();
        let err = user_set_active(&conn, a.uid, true, false).unwrap_err();
        assert!(err.to_string().contains("already in use"), "{err}");
    }

    #[test]
    fn user_create_without_display_id_ok() {
        let conn = migrated_in_memory();
        let u = user_create(&conn, new_user("Anna", None, false)).unwrap();
        assert_eq!(u.display_id, None);
        assert!(u.active);
    }

    #[test]
    fn user_deactivate_clear_frees_tag_and_reactivate_without_tag_ok() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        // Deactivate retaining the tag → still occupies "10".
        let a1 = user_set_active(&conn, a.uid, false, false).unwrap();
        assert_eq!(a1.display_id.as_deref(), Some("10"));
        // Clear the tag → "10" freed.
        let a2 = user_set_active(&conn, a.uid, false, true).unwrap();
        assert_eq!(a2.display_id, None);
        // Reactivating without a tag is now allowed.
        let a3 = user_set_active(&conn, a.uid, true, false).unwrap();
        assert!(a3.active);
        assert_eq!(a3.display_id, None);
    }

    #[test]
    fn preferred_weapon_set_replace_clear() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let w1 = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w2 = weapon_create(&conn, new_weapon(Some("W2"), Some("S-2"))).unwrap();

        let a = user_set_preferred_weapon(&conn, a.uid, Some(w1.uid)).unwrap();
        assert_eq!(a.preferred_weapon_uid, Some(w1.uid));
        // Replacing the member's own preference is allowed.
        let a = user_set_preferred_weapon(&conn, a.uid, Some(w2.uid)).unwrap();
        assert_eq!(a.preferred_weapon_uid, Some(w2.uid));
        // Clearing.
        let a = user_set_preferred_weapon(&conn, a.uid, None).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
    }

    #[test]
    fn preferred_weapon_exclusive_per_weapon() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let b = user_create(&conn, new_user("Björn", Some("11"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();

        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        // Re-setting the same weapon for the same member is idempotent, not an error.
        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        // Another member wanting the same weapon is rejected, naming Anna.
        let err = user_set_preferred_weapon(&conn, b.uid, Some(w.uid)).unwrap_err();
        assert_eq!(err.code, "err_weapon_already_preferred");
        assert!(err.to_string().contains("Anna"), "{err}");
    }

    #[test]
    fn preferred_weapon_rejects_inactive_and_missing() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        weapon_set_active(&conn, w.uid, false, None, false).unwrap();

        let err = user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap_err();
        assert_eq!(err.code, "err_weapon_inactive");
        let err = user_set_preferred_weapon(&conn, a.uid, Some(9999)).unwrap_err();
        assert_eq!(err.code, "err_weapon_not_found");
        let err = user_set_preferred_weapon(&conn, 9999, None).unwrap_err();
        assert_eq!(err.code, "err_user_not_found");
    }

    #[test]
    fn deactivating_member_clears_preferred_weapon() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let b = user_create(&conn, new_user("Björn", Some("11"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();

        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        let a = user_set_active(&conn, a.uid, false, false).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
        // Freed slot is claimable by another member.
        let b = user_set_preferred_weapon(&conn, b.uid, Some(w.uid)).unwrap();
        assert_eq!(b.preferred_weapon_uid, Some(w.uid));
        // Reactivation does not restore the old favorite.
        let a = user_set_active(&conn, a.uid, true, false).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
    }

    #[test]
    fn weapon_serial_globally_unique() {
        let conn = migrated_in_memory();
        weapon_create(&conn, new_weapon(Some("W1"), Some("S-100"))).unwrap();
        let err = weapon_create(&conn, new_weapon(Some("W2"), Some("S-100"))).unwrap_err();
        assert!(err.to_string().contains("already registered"), "{err}");
    }

    #[test]
    fn operators_list_filters_staff_and_active() {
        let conn = migrated_in_memory();
        user_create(&conn, new_user("Staff Sara", Some("1"), true)).unwrap();
        user_create(&conn, new_user("Member Mats", Some("2"), false)).unwrap();
        let retired = user_create(&conn, new_user("Old Olle", Some("3"), true)).unwrap();
        user_set_active(&conn, retired.uid, false, false).unwrap();

        let ops = operators_list(&conn).unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].name, "Staff Sara");
    }

    #[test]
    fn deactivating_weapon_records_reason_and_reactivating_clears_it() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w = weapon_set_active(&conn, w.uid, false, Some("barrel wear".into()), false).unwrap();
        assert!(!w.active);
        assert_eq!(w.inactive_reason.as_deref(), Some("barrel wear"));
        // Tag retained while inactive.
        assert_eq!(w.display_id.as_deref(), Some("W1"));
        let w = weapon_set_active(&conn, w.uid, true, None, false).unwrap();
        assert!(w.active);
        assert_eq!(w.inactive_reason, None);
    }

    #[test]
    fn weapon_create_requires_display_id() {
        let conn = migrated_in_memory();
        let err = weapon_create(&conn, new_weapon(None, Some("S-1"))).unwrap_err();
        assert_eq!(err.code, "err_display_id_required");
    }

    #[test]
    fn active_weapon_update_cannot_clear_display_id() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let mut upd = UpdateWeapon {
            uid: w.uid,
            display_id: None,
            brand: w.brand.clone(),
            model: w.model.clone(),
            serial: w.serial.clone(),
            caliber: w.caliber.clone(),
            notes: None,
        };
        let err = weapon_update(&conn, upd).unwrap_err();
        assert_eq!(err.code, "err_display_id_required");
        // Inactive weapons may have the tag cleared.
        weapon_set_active(&conn, w.uid, false, None, false).unwrap();
        upd = UpdateWeapon {
            uid: w.uid,
            display_id: None,
            brand: w.brand,
            model: w.model,
            serial: w.serial,
            caliber: w.caliber,
            notes: None,
        };
        let w = weapon_update(&conn, upd).unwrap();
        assert_eq!(w.display_id, None);
    }

    #[test]
    fn deactivate_can_clear_tag_and_reactivate_requires_one() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        // Clear the tag so it frees up for another weapon.
        let w = weapon_set_active(&conn, w.uid, false, Some("retired".into()), true).unwrap();
        assert_eq!(w.display_id, None);
        // The freed tag is usable on a new active weapon.
        weapon_create(&conn, new_weapon(Some("W1"), Some("S-2"))).unwrap();
        // Reactivating the tagless weapon is rejected until it gets a tag.
        let err = weapon_set_active(&conn, w.uid, true, None, false).unwrap_err();
        assert_eq!(err.code, "err_display_id_required");
    }

    #[test]
    fn next_free_display_id_finds_first_gap() {
        let conn = migrated_in_memory();
        assert_eq!(next_free_weapon_display_id(&conn).unwrap(), "1");
        weapon_create(&conn, new_weapon(Some("1"), Some("S-1"))).unwrap();
        weapon_create(&conn, new_weapon(Some("3"), Some("S-3"))).unwrap();
        // Non-numeric tag is ignored.
        weapon_create(&conn, new_weapon(Some("ABC"), Some("S-9"))).unwrap();
        assert_eq!(next_free_weapon_display_id(&conn).unwrap(), "2");
        weapon_create(&conn, new_weapon(Some("2"), Some("S-2"))).unwrap();
        assert_eq!(next_free_weapon_display_id(&conn).unwrap(), "4");
    }

    #[test]
    fn next_free_display_id_counts_retained_inactive_tags() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("1"), Some("S-1"))).unwrap();
        // Deactivated but tag retained → "1" is still physically in use.
        weapon_set_active(&conn, w.uid, false, None, false).unwrap();
        assert_eq!(next_free_weapon_display_id(&conn).unwrap(), "2");
        // Clearing the tag frees it again.
        weapon_set_active(&conn, w.uid, false, None, true).unwrap();
        assert_eq!(next_free_weapon_display_id(&conn).unwrap(), "1");
    }

    #[test]
    fn user_has_no_preferred_weapon_by_default() {
        let conn = migrated_in_memory();
        let u = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        assert_eq!(u.preferred_weapon_uid, None);
    }

    #[test]
    fn weapon_caliber_round_trips() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        assert_eq!(w.caliber.as_deref(), Some("9mm"));
    }

    #[test]
    fn new_user_defaults_not_guest_not_admin() {
        let conn = migrated_in_memory();
        let u = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        assert!(!u.is_guest);
        assert!(!u.is_admin);
    }

    #[test]
    fn new_weapon_defaults_no_tags() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        assert!(!w.tag_needs_service && !w.tag_broken && !w.tag_missing_parts && !w.tag_needs_cleaning);
        assert_eq!(w.tag_comment, None);
    }

    #[test]
    fn upsert_guest_creates_and_reuses_by_ssn() {
        let conn = migrated_in_memory();
        let g = user_upsert_guest(&conn, "Gunnar Gäst".into(), "19900101-1234".into()).unwrap();
        assert!(g.is_guest);
        assert!(g.active);
        assert_eq!(g.display_id, None);
        // Repeat visit: same SSN → same row, name NOT overwritten.
        let g2 = user_upsert_guest(&conn, "Other Name".into(), "19900101-1234".into()).unwrap();
        assert_eq!(g2.uid, g.uid);
        assert_eq!(g2.name, "Gunnar Gäst");
    }

    #[test]
    fn upsert_guest_rejects_member_ssn_and_requires_fields() {
        let conn = migrated_in_memory();
        let mut member = new_user("Anna", Some("10"), false);
        member.ssn = Some("19850505-5555".into());
        user_create(&conn, member).unwrap();
        let err = user_upsert_guest(&conn, "Anna Igen".into(), "19850505-5555".into()).unwrap_err();
        assert_eq!(err.code, "err_ssn_belongs_to_member");
        let err = user_upsert_guest(&conn, "NoSsn".into(), "  ".into()).unwrap_err();
        assert_eq!(err.code, "err_ssn_required");
        let err = user_upsert_guest(&conn, " ".into(), "19900101-1234".into()).unwrap_err();
        assert_eq!(err.code, "err_name_required");
    }

    #[test]
    fn upsert_guest_normalizes_ssn_and_reuses_across_input_styles() {
        let conn = migrated_in_memory();
        // 10 digits, no dash: century inferred (87 → 1987).
        let g = user_upsert_guest(&conn, "Tio Siffror".into(), "8707077777".into()).unwrap();
        assert_eq!(g.ssn.as_deref(), Some("19870707-7777"));
        // Canonical and spaced 12-digit forms hit the same row.
        let g2 = user_upsert_guest(&conn, "Annat Namn".into(), "19870707-7777".into()).unwrap();
        assert_eq!(g2.uid, g.uid);
        let g3 = user_upsert_guest(&conn, "Annat Namn".into(), " 19870707 7777 ".into()).unwrap();
        assert_eq!(g3.uid, g.uid);
    }

    #[test]
    fn upsert_guest_ssn_century_inference_and_rejections() {
        let conn = migrated_in_memory();
        // YY after the current 2-digit year → 19xx.
        let g = user_upsert_guest(&conn, "Nittiotal".into(), "990101-1234".into()).unwrap();
        assert_eq!(g.ssn.as_deref(), Some("19990101-1234"));
        for bad in ["123456789", "abcdefghij", "19871307-7777", "19870732-7777"] {
            let err = user_upsert_guest(&conn, "Ogiltig".into(), bad.into()).unwrap_err();
            assert_eq!(err.code, "err_ssn_invalid", "input: {bad}");
        }
    }

    #[test]
    fn promote_guest_clears_flag_and_rejects_non_guests() {
        let conn = migrated_in_memory();
        let g = user_upsert_guest(&conn, "Gunnar".into(), "19900101-1234".into()).unwrap();
        let m = user_promote_guest(&conn, g.uid).unwrap();
        assert!(!m.is_guest);
        let err = user_promote_guest(&conn, m.uid).unwrap_err();
        assert_eq!(err.code, "err_not_a_guest");
        let err = user_promote_guest(&conn, 9999).unwrap_err();
        assert_eq!(err.code, "err_user_not_found");
    }

    #[test]
    fn set_weapon_tags_round_trips_and_clears() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w = weapon_set_tags(&conn, w.uid, true, false, true, false, Some("kolv lös".into())).unwrap();
        assert!(w.tag_needs_service && w.tag_missing_parts);
        assert!(!w.tag_broken && !w.tag_needs_cleaning);
        assert_eq!(w.tag_comment.as_deref(), Some("kolv lös"));
        let w = weapon_set_tags(&conn, w.uid, false, false, false, false, None).unwrap();
        assert!(!w.tag_needs_service && !w.tag_missing_parts);
        assert_eq!(w.tag_comment, None);
        assert!(weapon_set_tags(&conn, 9999, false, false, false, false, None).is_err());
    }

    #[test]
    fn admin_exists_reflects_active_admins() {
        let conn = migrated_in_memory();
        assert!(!admin_exists(&conn).unwrap());
        let mut nu = new_user("Boss", Some("1"), true);
        nu.is_admin = true;
        let boss = user_create(&conn, nu).unwrap();
        assert!(admin_exists(&conn).unwrap());
        user_set_active(&conn, boss.uid, false, false).unwrap();
        assert!(!admin_exists(&conn).unwrap());
    }
}
