//! Weapon service history. Append-only, operator-tagged. The weapon is referenced
//! by uid; its identity is resolved live by the caller (no snapshot stored).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::commands::weapon_get;
use crate::db::Db;
use crate::error::AppError;

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn norm(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLog {
    pub id: i64,
    pub weapon_uid: i64,
    pub operator_uid: i64,
    pub operator_name: Option<String>,
    pub serviced_at: String,
    pub description: String,
    pub notes: Option<String>,
}

pub(crate) fn add(
    conn: &Connection,
    weapon_uid: i64,
    operator_uid: i64,
    description: String,
    notes: Option<String>,
    serviced_at: Option<String>,
) -> Result<ServiceLog, AppError> {
    let description = description.trim().to_string();
    if description.is_empty() {
        return Err(AppError::service_description_required());
    }
    weapon_get(conn, weapon_uid)?.ok_or_else(|| AppError::weapon_not_found(weapon_uid))?;
    let when = norm(serviced_at).unwrap_or_else(now_utc);
    conn.execute(
        "INSERT INTO weapon_service_log
           (weapon_uid, operator_uid, serviced_at, description, notes)
         VALUES (?1,?2,?3,?4,?5)",
        params![weapon_uid, operator_uid, when, description, norm(notes)],
    )?;
    get(conn, conn.last_insert_rowid())?
        .ok_or_else(|| AppError::internal("inserted service entry not found"))
}

fn get(conn: &Connection, id: i64) -> Result<Option<ServiceLog>, AppError> {
    Ok(conn
        .query_row(
            "SELECT s.id, s.weapon_uid, s.operator_uid,
                    o.name, s.serviced_at, s.description, s.notes
             FROM weapon_service_log s LEFT JOIN users o ON o.uid = s.operator_uid
             WHERE s.id = ?1",
            params![id],
            row_to_log,
        )
        .optional()?)
}

fn list_for_weapon(conn: &Connection, weapon_uid: i64) -> Result<Vec<ServiceLog>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.weapon_uid, s.operator_uid,
                o.name, s.serviced_at, s.description, s.notes
         FROM weapon_service_log s LEFT JOIN users o ON o.uid = s.operator_uid
         WHERE s.weapon_uid = ?1
         ORDER BY s.serviced_at DESC, s.id DESC",
    )?;
    let rows = stmt.query_map(params![weapon_uid], row_to_log)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn row_to_log(r: &rusqlite::Row) -> rusqlite::Result<ServiceLog> {
    Ok(ServiceLog {
        id: r.get(0)?,
        weapon_uid: r.get(1)?,
        operator_uid: r.get(2)?,
        operator_name: r.get(3)?,
        serviced_at: r.get(4)?,
        description: r.get(5)?,
        notes: r.get(6)?,
    })
}

// ---------- Command wrappers ----------

#[tauri::command]
pub fn add_service(
    db: State<Db>,
    weapon_uid: i64,
    operator_uid: i64,
    description: String,
    notes: Option<String>,
    serviced_at: Option<String>,
) -> Result<ServiceLog, AppError> {
    let conn = lock(&db)?;
    add(&conn, weapon_uid, operator_uid, description, notes, serviced_at)
}

#[tauri::command]
pub fn list_weapon_service(db: State<Db>, weapon_uid: i64) -> Result<Vec<ServiceLog>, AppError> {
    let conn = lock(&db)?;
    list_for_weapon(&conn, weapon_uid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{user_create, weapon_create};
    use crate::db::migrated_in_memory;
    use crate::models::{NewUser, NewWeapon};

    fn mk_op(conn: &Connection) -> i64 {
        user_create(
            conn,
            NewUser {
                display_id: Some("OP".into()),
                name: "Op".into(),
                email: None,
                phone: None,
                address: None,
                ssn: None,
                is_staff: true,
                is_admin: false,
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    fn mk_weapon(conn: &Connection) -> i64 {
        weapon_create(
            conn,
            NewWeapon {
                display_id: Some("W1".into()),
                brand: Some("Glock".into()),
                model: Some("17".into()),
                serial: Some("S-1".into()),
                caliber: None,
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    #[test]
    fn add_lists_and_resolves_operator() {
        let conn = migrated_in_memory();
        let op = mk_op(&conn);
        let w = mk_weapon(&conn);

        let s = add(&conn, w, op, "  Cleaned barrel  ".into(), None, None).unwrap();
        assert_eq!(s.description, "Cleaned barrel");
        assert_eq!(s.operator_name.as_deref(), Some("Op"));

        let list = list_for_weapon(&conn, w).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn rejects_empty_description() {
        let conn = migrated_in_memory();
        let op = mk_op(&conn);
        let w = mk_weapon(&conn);
        assert!(add(&conn, w, op, "   ".into(), None, None).is_err());
    }
}
