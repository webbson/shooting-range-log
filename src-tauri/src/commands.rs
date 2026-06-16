//! Tauri commands for user & weapon CRUD, plus the display_id reassignment rule.
//!
//! Logic lives in inner `*_inner`-style fns that take `&Connection` so they are
//! unit-testable without a Tauri runtime; thin `#[tauri::command]` wrappers lock
//! the shared connection and delegate.

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
        return Err(AppError::Other("Name is required.".into()));
    }
    Ok(n)
}

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0
        .lock()
        .map_err(|_| AppError::Other("db lock poisoned".into()))
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
        return Err(AppError::Other(format!(
            "Display ID '{did}' is already in use by another active record."
        )));
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
        return Err(AppError::Other(format!(
            "Serial '{s}' is already registered to another weapon."
        )));
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

fn user_get(conn: &Connection, uid: i64) -> Result<Option<User>, AppError> {
    let sql = format!("SELECT {USER_COLS} FROM users WHERE uid = ?1");
    Ok(conn
        .query_row(&sql, params![uid], |r| User::from_row(r))
        .optional()?)
}

fn user_require(conn: &Connection, uid: i64) -> Result<User, AppError> {
    user_get(conn, uid)?.ok_or_else(|| AppError::Other(format!("User {uid} not found.")))
}

fn user_create(conn: &Connection, input: NewUser) -> Result<User, AppError> {
    let display_id = norm(input.display_id);
    let name = require_name(input.name)?;
    ensure_display_id_free(conn, "users", &display_id, None)?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO users
           (display_id, member_number, name, email, phone, address, ssn, is_staff, active, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?10)",
        params![
            display_id,
            norm(input.member_number),
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            norm(input.notes),
            now,
        ],
    )?;
    user_require(conn, conn.last_insert_rowid())
}

fn user_update(conn: &Connection, input: UpdateUser) -> Result<User, AppError> {
    let display_id = norm(input.display_id);
    let name = require_name(input.name)?;
    ensure_display_id_free(conn, "users", &display_id, Some(input.uid))?;
    let affected = conn.execute(
        "UPDATE users SET
           display_id = ?2, member_number = ?3, name = ?4, email = ?5, phone = ?6,
           address = ?7, ssn = ?8, is_staff = ?9, notes = ?10, updated_at = ?11
         WHERE uid = ?1",
        params![
            input.uid,
            display_id,
            norm(input.member_number),
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            norm(input.notes),
            now_utc(),
        ],
    )?;
    if affected == 0 {
        return Err(AppError::Other(format!("User {} not found.", input.uid)));
    }
    user_require(conn, input.uid)
}

fn user_set_active(conn: &Connection, uid: i64, active: bool) -> Result<User, AppError> {
    let current = user_require(conn, uid)?;
    if active {
        // Reactivating: the tag must still be free among other active users.
        ensure_display_id_free(conn, "users", &current.display_id, Some(uid))?;
    }
    conn.execute(
        "UPDATE users SET active = ?2, updated_at = ?3 WHERE uid = ?1",
        params![uid, active, now_utc()],
    )?;
    user_require(conn, uid)
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

fn weapon_get(conn: &Connection, uid: i64) -> Result<Option<Weapon>, AppError> {
    let sql = format!("SELECT {WEAPON_COLS} FROM weapons WHERE uid = ?1");
    Ok(conn
        .query_row(&sql, params![uid], |r| Weapon::from_row(r))
        .optional()?)
}

fn weapon_require(conn: &Connection, uid: i64) -> Result<Weapon, AppError> {
    weapon_get(conn, uid)?.ok_or_else(|| AppError::Other(format!("Weapon {uid} not found.")))
}

fn weapon_create(conn: &Connection, input: NewWeapon) -> Result<Weapon, AppError> {
    let display_id = norm(input.display_id);
    let serial = norm(input.serial);
    ensure_display_id_free(conn, "weapons", &display_id, None)?;
    ensure_serial_free(conn, &serial, None)?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO weapons
           (display_id, brand, model, serial, active, inactive_reason, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,1,NULL,?5,?6,?6)",
        params![
            display_id,
            norm(input.brand),
            norm(input.model),
            serial,
            norm(input.notes),
            now,
        ],
    )?;
    weapon_require(conn, conn.last_insert_rowid())
}

fn weapon_update(conn: &Connection, input: UpdateWeapon) -> Result<Weapon, AppError> {
    let display_id = norm(input.display_id);
    let serial = norm(input.serial);
    ensure_display_id_free(conn, "weapons", &display_id, Some(input.uid))?;
    ensure_serial_free(conn, &serial, Some(input.uid))?;
    let affected = conn.execute(
        "UPDATE weapons SET
           display_id = ?2, brand = ?3, model = ?4, serial = ?5, notes = ?6, updated_at = ?7
         WHERE uid = ?1",
        params![
            input.uid,
            display_id,
            norm(input.brand),
            norm(input.model),
            serial,
            norm(input.notes),
            now_utc(),
        ],
    )?;
    if affected == 0 {
        return Err(AppError::Other(format!("Weapon {} not found.", input.uid)));
    }
    weapon_require(conn, input.uid)
}

fn weapon_set_active(
    conn: &Connection,
    uid: i64,
    active: bool,
    inactive_reason: Option<String>,
) -> Result<Weapon, AppError> {
    let current = weapon_require(conn, uid)?;
    if active {
        // Reactivating: tag + serial must still be free.
        ensure_display_id_free(conn, "weapons", &current.display_id, Some(uid))?;
        ensure_serial_free(conn, &current.serial, Some(uid))?;
        conn.execute(
            "UPDATE weapons SET active = 1, inactive_reason = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    } else {
        conn.execute(
            "UPDATE weapons SET active = 0, inactive_reason = ?2, updated_at = ?3 WHERE uid = ?1",
            params![uid, norm(inactive_reason), now_utc()],
        )?;
    }
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
pub fn set_user_active(db: State<Db>, uid: i64, active: bool) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_set_active(&conn, uid, active)
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
) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_set_active(&conn, uid, active, inactive_reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;

    fn new_user(name: &str, display_id: Option<&str>, is_staff: bool) -> NewUser {
        NewUser {
            display_id: display_id.map(String::from),
            member_number: None,
            name: name.into(),
            email: None,
            phone: None,
            address: None,
            ssn: None,
            is_staff,
            notes: None,
        }
    }

    fn new_weapon(display_id: Option<&str>, serial: Option<&str>) -> NewWeapon {
        NewWeapon {
            display_id: display_id.map(String::from),
            brand: Some("Glock".into()),
            model: Some("17".into()),
            serial: serial.map(String::from),
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
        user_set_active(&conn, a.uid, false).unwrap();
        // Tag "10" is now free for a new active user.
        let c = user_create(&conn, new_user("Cecilia", Some("10"), false)).unwrap();
        assert_eq!(c.display_id.as_deref(), Some("10"));
    }

    #[test]
    fn reactivating_into_taken_display_id_fails() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        user_set_active(&conn, a.uid, false).unwrap();
        user_create(&conn, new_user("Cecilia", Some("10"), false)).unwrap();
        let err = user_set_active(&conn, a.uid, true).unwrap_err();
        assert!(err.to_string().contains("already in use"), "{err}");
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
        user_set_active(&conn, retired.uid, false).unwrap();

        let ops = operators_list(&conn).unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].name, "Staff Sara");
    }

    #[test]
    fn deactivating_weapon_records_reason_and_reactivating_clears_it() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w = weapon_set_active(&conn, w.uid, false, Some("barrel wear".into())).unwrap();
        assert!(!w.active);
        assert_eq!(w.inactive_reason.as_deref(), Some("barrel wear"));
        let w = weapon_set_active(&conn, w.uid, true, None).unwrap();
        assert!(w.active);
        assert_eq!(w.inactive_reason, None);
    }
}
