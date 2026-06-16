//! Debt tracking. Free-form whole-kronor amounts owed by a member, optionally
//! linked to the checkout that incurred them. Append-only: settling sets
//! `settled_at`/`settled_operator_uid`, it never deletes. Outstanding totals
//! feed the checkout debt banner and the members list.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::commands::user_get;
use crate::db::Db;
use crate::error::AppError;

pub const DEBT_COLS: &str = "id, user_uid, user_name_snapshot, operator_uid, amount_kr, reason, created_at, settled_at, settled_operator_uid, checkout_id";

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
pub struct Debt {
    pub id: i64,
    pub user_uid: i64,
    pub user_name_snapshot: Option<String>,
    pub operator_uid: i64,
    pub amount_kr: i64,
    pub reason: Option<String>,
    pub created_at: String,
    pub settled_at: Option<String>,
    pub settled_operator_uid: Option<i64>,
    pub checkout_id: Option<i64>,
}

impl Debt {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Debt> {
        Ok(Debt {
            id: row.get("id")?,
            user_uid: row.get("user_uid")?,
            user_name_snapshot: row.get("user_name_snapshot")?,
            operator_uid: row.get("operator_uid")?,
            amount_kr: row.get("amount_kr")?,
            reason: row.get("reason")?,
            created_at: row.get("created_at")?,
            settled_at: row.get("settled_at")?,
            settled_operator_uid: row.get("settled_operator_uid")?,
            checkout_id: row.get("checkout_id")?,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutstandingDebt {
    pub user_uid: i64,
    pub amount_kr: i64,
}

fn debt_get(conn: &Connection, id: i64) -> Result<Option<Debt>, AppError> {
    let sql = format!("SELECT {DEBT_COLS} FROM debts WHERE id = ?1");
    Ok(conn
        .query_row(&sql, params![id], |r| Debt::from_row(r))
        .optional()?)
}

fn debt_require(conn: &Connection, id: i64) -> Result<Debt, AppError> {
    debt_get(conn, id)?.ok_or_else(|| AppError::debt_not_found(id))
}

fn add(
    conn: &Connection,
    user_uid: i64,
    operator_uid: i64,
    amount_kr: i64,
    reason: Option<String>,
    checkout_id: Option<i64>,
) -> Result<Debt, AppError> {
    if amount_kr <= 0 {
        return Err(AppError::debt_amount_invalid());
    }
    let user = user_get(conn, user_uid)?.ok_or_else(|| AppError::user_not_found(user_uid))?;
    conn.execute(
        "INSERT INTO debts
           (user_uid, user_name_snapshot, operator_uid, amount_kr, reason, created_at, checkout_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            user_uid,
            user.name,
            operator_uid,
            amount_kr,
            norm(reason),
            now_utc(),
            checkout_id,
        ],
    )?;
    debt_require(conn, conn.last_insert_rowid())
}

fn list_for_user(conn: &Connection, user_uid: i64) -> Result<Vec<Debt>, AppError> {
    // Outstanding first, then newest.
    let sql = format!(
        "SELECT {DEBT_COLS} FROM debts WHERE user_uid = ?1
         ORDER BY (settled_at IS NULL) DESC, created_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![user_uid], Debt::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn settle(conn: &Connection, debt_id: i64, operator_uid: i64) -> Result<Debt, AppError> {
    let d = debt_require(conn, debt_id)?;
    if d.settled_at.is_some() {
        return Err(AppError::debt_already_settled());
    }
    conn.execute(
        "UPDATE debts SET settled_at = ?2, settled_operator_uid = ?3 WHERE id = ?1",
        params![debt_id, now_utc(), operator_uid],
    )?;
    debt_require(conn, debt_id)
}

fn outstanding(conn: &Connection) -> Result<Vec<OutstandingDebt>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT user_uid, SUM(amount_kr) AS total FROM debts
         WHERE settled_at IS NULL GROUP BY user_uid HAVING total > 0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(OutstandingDebt {
            user_uid: r.get(0)?,
            amount_kr: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---------- Command wrappers ----------

#[tauri::command]
pub fn add_debt(
    db: State<Db>,
    user_uid: i64,
    operator_uid: i64,
    amount_kr: i64,
    reason: Option<String>,
    checkout_id: Option<i64>,
) -> Result<Debt, AppError> {
    let conn = lock(&db)?;
    add(&conn, user_uid, operator_uid, amount_kr, reason, checkout_id)
}

#[tauri::command]
pub fn list_user_debts(db: State<Db>, user_uid: i64) -> Result<Vec<Debt>, AppError> {
    let conn = lock(&db)?;
    list_for_user(&conn, user_uid)
}

#[tauri::command]
pub fn settle_debt(db: State<Db>, debt_id: i64, operator_uid: i64) -> Result<Debt, AppError> {
    let conn = lock(&db)?;
    settle(&conn, debt_id, operator_uid)
}

#[tauri::command]
pub fn outstanding_debts(db: State<Db>) -> Result<Vec<OutstandingDebt>, AppError> {
    let conn = lock(&db)?;
    outstanding(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::user_create;
    use crate::db::migrated_in_memory;
    use crate::models::NewUser;

    fn mk_user(conn: &Connection, name: &str) -> i64 {
        user_create(
            conn,
            NewUser {
                display_id: None,
                member_number: None,
                name: name.into(),
                email: None,
                phone: None,
                address: None,
                ssn: None,
                is_staff: false,
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    #[test]
    fn add_lists_and_snapshots_name() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op");
        let anna = mk_user(&conn, "Anna");

        let d = add(&conn, anna, op, 150, Some("range fee".into()), None).unwrap();
        assert_eq!(d.amount_kr, 150);
        assert_eq!(d.user_name_snapshot.as_deref(), Some("Anna"));
        assert!(d.settled_at.is_none());

        let list = list_for_user(&conn, anna).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn rejects_non_positive_amount() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op");
        let anna = mk_user(&conn, "Anna");
        assert!(add(&conn, anna, op, 0, None, None).is_err());
        assert!(add(&conn, anna, op, -50, None, None).is_err());
    }

    #[test]
    fn settle_marks_and_rejects_double_settle() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op");
        let anna = mk_user(&conn, "Anna");
        let d = add(&conn, anna, op, 100, None, None).unwrap();

        let s = settle(&conn, d.id, op).unwrap();
        assert!(s.settled_at.is_some());
        assert_eq!(s.settled_operator_uid, Some(op));
        assert!(settle(&conn, d.id, op).is_err());
    }

    #[test]
    fn outstanding_sums_unsettled_per_user() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op");
        let anna = mk_user(&conn, "Anna");
        let bjorn = mk_user(&conn, "Björn");

        add(&conn, anna, op, 150, None, None).unwrap();
        add(&conn, anna, op, 50, None, None).unwrap();
        let paid = add(&conn, anna, op, 999, None, None).unwrap();
        settle(&conn, paid.id, op).unwrap();
        add(&conn, bjorn, op, 75, None, None).unwrap();

        let out = outstanding(&conn).unwrap();
        let anna_total = out.iter().find(|o| o.user_uid == anna).unwrap().amount_kr;
        let bjorn_total = out.iter().find(|o| o.user_uid == bjorn).unwrap().amount_kr;
        assert_eq!(anna_total, 200);
        assert_eq!(bjorn_total, 75);
    }
}
