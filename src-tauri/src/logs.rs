//! Read-only log views over the append-only `checkouts` table. One filterable
//! query serves both "weapon checkout history" (filter by weapon) and "member
//! shooting log" (filter by member). Identity (weapon, member, operators) is
//! resolved live by uid — history reflects each entity's current name/status,
//! not a point-in-time snapshot (snapshots would mis-attribute a reassigned tag).

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutLog {
    pub id: i64,
    pub weapon_uid: i64,
    pub user_uid: i64,
    // Live identity (looked up by uid), composed for display by the frontend.
    pub user_name: Option<String>,
    pub user_display_id: Option<String>,
    pub user_active: bool,
    pub weapon_brand: Option<String>,
    pub weapon_model: Option<String>,
    pub weapon_serial: Option<String>,
    pub weapon_display_id: Option<String>,
    pub weapon_caliber: Option<String>,
    pub weapon_active: bool,
    pub checked_out_at: String,
    pub checked_in_at: Option<String>,
    pub operator_out_name: Option<String>,
    pub operator_in_name: Option<String>,
    pub notes: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn query(
    conn: &Connection,
    weapon_uid: Option<i64>,
    user_uid: Option<i64>,
    operator_uid: Option<i64>,
    from: Option<String>,
    to: Option<String>,
    only_open: bool,
) -> Result<Vec<CheckoutLog>, AppError> {
    // Date filter compares the YYYY-MM-DD prefix of the UTC timestamp.
    let mut stmt = conn.prepare(
        "SELECT c.id, c.weapon_uid, c.user_uid,
                u.name, u.display_id, u.active,
                w.brand, w.model, w.serial, w.active,
                c.checked_out_at, c.checked_in_at,
                oo.name AS op_out_name, oi.name AS op_in_name, c.notes,
                w.display_id, w.caliber
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         JOIN weapons w ON w.uid = c.weapon_uid
         LEFT JOIN users oo ON oo.uid = c.operator_out_uid
         LEFT JOIN users oi ON oi.uid = c.operator_in_uid
         WHERE (?1 IS NULL OR c.weapon_uid = ?1)
           AND (?2 IS NULL OR c.user_uid = ?2)
           AND (?3 IS NULL OR c.operator_out_uid = ?3 OR c.operator_in_uid = ?3)
           AND (?4 IS NULL OR substr(c.checked_out_at, 1, 10) >= ?4)
           AND (?5 IS NULL OR substr(c.checked_out_at, 1, 10) <= ?5)
           AND (?6 = 0 OR c.checked_in_at IS NULL)
         ORDER BY c.checked_out_at DESC, c.id DESC",
    )?;
    let rows = stmt.query_map(
        params![weapon_uid, user_uid, operator_uid, from, to, only_open as i64],
        |r| {
            Ok(CheckoutLog {
                id: r.get(0)?,
                weapon_uid: r.get(1)?,
                user_uid: r.get(2)?,
                user_name: r.get(3)?,
                user_display_id: r.get(4)?,
                user_active: r.get(5)?,
                weapon_brand: r.get(6)?,
                weapon_model: r.get(7)?,
                weapon_serial: r.get(8)?,
                weapon_active: r.get(9)?,
                checked_out_at: r.get(10)?,
                checked_in_at: r.get(11)?,
                operator_out_name: r.get(12)?,
                operator_in_name: r.get(13)?,
                notes: r.get(14)?,
                weapon_display_id: r.get(15)?,
                weapon_caliber: r.get(16)?,
            })
        },
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_checkouts(
    db: State<Db>,
    weapon_uid: Option<i64>,
    user_uid: Option<i64>,
    operator_uid: Option<i64>,
    from: Option<String>,
    to: Option<String>,
    only_open: Option<bool>,
) -> Result<Vec<CheckoutLog>, AppError> {
    let conn = lock(&db)?;
    query(
        &conn,
        weapon_uid,
        user_uid,
        operator_uid,
        from,
        to,
        only_open.unwrap_or(false),
    )
}

/// Most recent shooting date per member (`MAX(checked_out_at)`), for the members
/// list "last shot" column. Mirrors `outstanding_debts`: an aggregate keyed by
/// `user_uid` that the frontend folds into a Map. Only members with at least one
/// checkout appear; `checked_out_at` is NOT NULL so `last_shot_at` is never null.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastShot {
    pub user_uid: i64,
    pub last_shot_at: String,
}

fn last_shot_dates_q(conn: &Connection) -> Result<Vec<LastShot>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT user_uid, MAX(checked_out_at) AS last_shot_at
         FROM checkouts GROUP BY user_uid",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LastShot {
            user_uid: r.get(0)?,
            last_shot_at: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command]
pub fn last_shot_dates(db: State<Db>) -> Result<Vec<LastShot>, AppError> {
    let conn = lock(&db)?;
    last_shot_dates_q(&conn)
}

/// Most recent user per weapon (latest checkout row; `checked_out_at DESC,
/// id DESC` tiebreak). Identity resolved live by uid. Weapons with no history
/// are absent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponLastUse {
    pub weapon_uid: i64,
    pub user_uid: i64,
    pub user_name: Option<String>,
    pub user_display_id: Option<String>,
    pub user_active: bool,
    pub last_used_at: String,
}

fn last_weapon_users_q(conn: &Connection) -> Result<Vec<WeaponLastUse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.weapon_uid, c.user_uid, u.name, u.display_id, u.active, c.checked_out_at
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         WHERE c.id = (SELECT c2.id FROM checkouts c2 WHERE c2.weapon_uid = c.weapon_uid
                       ORDER BY c2.checked_out_at DESC, c2.id DESC LIMIT 1)",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WeaponLastUse {
            weapon_uid: r.get(0)?,
            user_uid: r.get(1)?,
            user_name: r.get(2)?,
            user_display_id: r.get(3)?,
            user_active: r.get(4)?,
            last_used_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command]
pub fn last_weapon_users(db: State<Db>) -> Result<Vec<WeaponLastUse>, AppError> {
    let conn = lock(&db)?;
    last_weapon_users_q(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkout::{do_checkin, do_checkout};
    use crate::commands::{user_create, weapon_create};
    use crate::db::migrated_in_memory;
    use crate::models::{NewUser, NewWeapon};

    fn mk_user(conn: &Connection, name: &str, staff: bool) -> i64 {
        user_create(
            conn,
            NewUser {
                display_id: Some(name.into()),
                name: name.into(),
                email: None,
                phone: None,
                address: None,
                ssn: None,
                is_staff: staff,
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    fn mk_weapon(conn: &Connection, display: &str) -> i64 {
        weapon_create(
            conn,
            NewWeapon {
                display_id: Some(display.into()),
                brand: Some("Glock".into()),
                model: Some("17".into()),
                serial: Some(format!("S-{display}")),
                caliber: None,
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    #[test]
    fn filters_by_weapon_user_operator_and_open() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", true);
        let anna = mk_user(&conn, "Anna", false);
        let bjorn = mk_user(&conn, "Björn", false);
        let w1 = mk_weapon(&conn, "W1");
        let w2 = mk_weapon(&conn, "W2");

        let c1 = do_checkout(&conn, w1, anna, op, None).unwrap();
        do_checkin(&conn, c1.id, op).unwrap();
        do_checkout(&conn, w2, bjorn, op, None).unwrap(); // still open

        // No filters → both.
        assert_eq!(query(&conn, None, None, None, None, None, false).unwrap().len(), 2);
        // By weapon.
        assert_eq!(query(&conn, Some(w1), None, None, None, None, false).unwrap().len(), 1);
        // By user.
        assert_eq!(query(&conn, None, Some(bjorn), None, None, None, false).unwrap().len(), 1);
        // By operator (involved in both).
        assert_eq!(query(&conn, None, None, Some(op), None, None, false).unwrap().len(), 2);
        // Only open.
        let open = query(&conn, None, None, None, None, None, true).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].weapon_uid, w2);
        assert_eq!(open[0].operator_out_name.as_deref(), Some("Op"));
    }

    #[test]
    fn last_shot_dates_returns_max_per_member_and_skips_non_shooters() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", true);
        let anna = mk_user(&conn, "Anna", false);
        let _never = mk_user(&conn, "Never", false); // no checkouts → absent
        let w1 = mk_weapon(&conn, "W1");
        let w2 = mk_weapon(&conn, "W2");

        let c1 = do_checkout(&conn, w1, anna, op, None).unwrap();
        do_checkin(&conn, c1.id, op).unwrap();
        let c2 = do_checkout(&conn, w2, anna, op, None).unwrap();
        let expected_max = c1.checked_out_at.max(c2.checked_out_at);

        let rows = last_shot_dates_q(&conn).unwrap();
        assert_eq!(rows.len(), 1); // only Anna shot
        assert_eq!(rows[0].user_uid, anna);
        assert_eq!(rows[0].last_shot_at, expected_max);
    }

    #[test]
    fn last_weapon_users_returns_latest_user_per_weapon() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", true);
        let anna = mk_user(&conn, "Anna", false);
        let bjorn = mk_user(&conn, "Björn", false);
        let w1 = mk_weapon(&conn, "W1");
        let _unused = mk_weapon(&conn, "W2"); // no history → absent

        // Anna then Björn on W1 — Björn is the latest (same timestamps possible;
        // id DESC tiebreak must pick the later row).
        let c1 = do_checkout(&conn, w1, anna, op, None).unwrap();
        do_checkin(&conn, c1.id, op).unwrap();
        let c2 = do_checkout(&conn, w1, bjorn, op, None).unwrap();

        let rows = last_weapon_users_q(&conn).unwrap();
        assert_eq!(rows.len(), 1); // only W1 has history
        assert_eq!(rows[0].weapon_uid, w1);
        assert_eq!(rows[0].user_uid, bjorn);
        assert_eq!(rows[0].user_name.as_deref(), Some("Björn"));
        assert!(rows[0].user_active);
        assert_eq!(rows[0].last_used_at, c2.checked_out_at);
    }

}
