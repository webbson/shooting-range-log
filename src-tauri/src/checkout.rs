//! Checkout / checkin: the core flow.
//!
//! `evaluate_checkout` computes everything the UI needs to autopopulate + render
//! banners (rules live here, not in JS). `checkout` re-validates server-side and
//! writes identity snapshots (display_id + name + weapon label) so historical log
//! rows read correctly even after a tag is reassigned. Logs are append-only:
//! checkin updates the open row's return fields; nothing is deleted.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::commands::{user_get, weapon_get};
use crate::db::Db;
use crate::error::AppError;
use crate::models::Weapon;

pub const CHECKOUT_COLS: &str = "id, weapon_uid, user_uid, weapon_display_snapshot, weapon_label_snapshot, user_display_snapshot, user_name_snapshot, operator_out_uid, checked_out_at, operator_in_uid, checked_in_at, notes";

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
pub struct Checkout {
    pub id: i64,
    pub weapon_uid: i64,
    pub user_uid: i64,
    pub weapon_display_snapshot: Option<String>,
    pub weapon_label_snapshot: Option<String>,
    pub user_display_snapshot: Option<String>,
    pub user_name_snapshot: Option<String>,
    pub operator_out_uid: i64,
    pub checked_out_at: String,
    pub operator_in_uid: Option<i64>,
    pub checked_in_at: Option<String>,
    pub notes: Option<String>,
}

impl Checkout {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Checkout> {
        Ok(Checkout {
            id: row.get("id")?,
            weapon_uid: row.get("weapon_uid")?,
            user_uid: row.get("user_uid")?,
            weapon_display_snapshot: row.get("weapon_display_snapshot")?,
            weapon_label_snapshot: row.get("weapon_label_snapshot")?,
            user_display_snapshot: row.get("user_display_snapshot")?,
            user_name_snapshot: row.get("user_name_snapshot")?,
            operator_out_uid: row.get("operator_out_uid")?,
            checked_out_at: row.get("checked_out_at")?,
            operator_in_uid: row.get("operator_in_uid")?,
            checked_in_at: row.get("checked_in_at")?,
            notes: row.get("notes")?,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCheckout {
    pub id: i64,
    pub weapon_uid: i64,
    pub user_uid: i64,
    pub weapon_display: Option<String>,
    pub weapon_label: Option<String>,
    pub user_display: Option<String>,
    pub user_name: Option<String>,
    pub checked_out_at: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutEval {
    /// Weapon's most-recent user, suggested when no user is picked yet.
    pub suggested_user_uid: Option<i64>,
    pub suggested_user_name: Option<String>,
    /// That suggested user already holds a weapon → don't autofill, warn instead.
    pub suggested_user_busy: bool,
    /// Member's most-recent weapon, suggested when no weapon is picked yet.
    pub suggested_weapon_uid: Option<i64>,
    pub suggested_weapon_label: Option<String>,
    /// That suggested weapon is currently out → don't autofill, warn instead.
    pub suggested_weapon_out: bool,
    pub weapon_inactive: bool,
    pub weapon_inactive_reason: Option<String>,
    pub weapon_already_out: bool,
    pub open_holder_name: Option<String>,
    pub open_checkout_id: Option<i64>,
    pub user_inactive: bool,
    pub user_outstanding_debt_kr: i64,
    /// Set when the picked user differs from the weapon's most-recent user.
    pub fresher_user_name: Option<String>,
    pub fresher_user_at: Option<String>,
    pub can_checkout: bool,
}

/// Human-readable weapon label for the snapshot, e.g. "Glock 17 (S-100)".
fn weapon_label(w: &Weapon) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(b) = w.brand.as_deref() {
        if !b.is_empty() {
            parts.push(b);
        }
    }
    if let Some(m) = w.model.as_deref() {
        if !m.is_empty() {
            parts.push(m);
        }
    }
    let base = parts.join(" ");
    let label = match w.serial.as_deref() {
        Some(s) if !s.is_empty() && base.is_empty() => s.to_string(),
        Some(s) if !s.is_empty() => format!("{base} ({s})"),
        _ => base,
    };
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

/// (user_uid, user_name, checked_out_at) of the weapon's most recent checkout.
fn most_recent_checkout(
    conn: &Connection,
    weapon_uid: i64,
) -> Result<Option<(i64, String, String)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT user_uid, user_name_snapshot, checked_out_at
             FROM checkouts WHERE weapon_uid = ?1
             ORDER BY checked_out_at DESC, id DESC LIMIT 1",
            params![weapon_uid],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?)
}

/// (checkout_id, holder_name) if the weapon is currently out.
fn open_checkout_for(
    conn: &Connection,
    weapon_uid: i64,
) -> Result<Option<(i64, String)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id, user_name_snapshot FROM checkouts
             WHERE weapon_uid = ?1 AND checked_in_at IS NULL
             ORDER BY id DESC LIMIT 1",
            params![weapon_uid],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
        )
        .optional()?)
}

/// (weapon_uid, label) of the member's most recent checkout — for member→weapon
/// autopopulate.
fn most_recent_weapon_for_user(
    conn: &Connection,
    user_uid: i64,
) -> Result<Option<(i64, String)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT weapon_uid, weapon_label_snapshot, weapon_display_snapshot
             FROM checkouts WHERE user_uid = ?1
             ORDER BY checked_out_at DESC, id DESC LIMIT 1",
            params![user_uid],
            |r| {
                let wuid: i64 = r.get(0)?;
                let label: Option<String> = r.get(1)?;
                let disp: Option<String> = r.get(2)?;
                Ok((wuid, label.or(disp).unwrap_or_default()))
            },
        )
        .optional()?)
}

/// True if the member currently holds any weapon (open checkout).
fn user_has_open(conn: &Connection, user_uid: i64) -> Result<bool, AppError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM checkouts WHERE user_uid = ?1 AND checked_in_at IS NULL LIMIT 1",
            params![user_uid],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn outstanding_debt(conn: &Connection, user_uid: i64) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(amount_kr), 0) FROM debts WHERE user_uid = ?1 AND settled_at IS NULL",
        params![user_uid],
        |r| r.get::<_, i64>(0),
    )?)
}

fn checkout_get(conn: &Connection, id: i64) -> Result<Option<Checkout>, AppError> {
    let sql = format!("SELECT {CHECKOUT_COLS} FROM checkouts WHERE id = ?1");
    Ok(conn
        .query_row(&sql, params![id], |r| Checkout::from_row(r))
        .optional()?)
}

fn evaluate(
    conn: &Connection,
    weapon_uid: Option<i64>,
    user_uid: Option<i64>,
) -> Result<CheckoutEval, AppError> {
    let mut eval = CheckoutEval::default();

    let mut most_recent: Option<(i64, String, String)> = None;
    if let Some(wuid) = weapon_uid {
        if let Some(w) = weapon_get(conn, wuid)? {
            if !w.active {
                eval.weapon_inactive = true;
                eval.weapon_inactive_reason = w.inactive_reason;
            }
            if let Some((cid, holder)) = open_checkout_for(conn, wuid)? {
                eval.weapon_already_out = true;
                eval.open_checkout_id = Some(cid);
                eval.open_holder_name = Some(holder);
            }
            most_recent = most_recent_checkout(conn, wuid)?;
        }
    }

    if let Some(uuid) = user_uid {
        if let Some(u) = user_get(conn, uuid)? {
            eval.user_inactive = !u.active;
        }
        eval.user_outstanding_debt_kr = outstanding_debt(conn, uuid)?;
    }

    // Suggestion / fresher-user only make sense when the weapon is available
    // (if it's already out, the already-out banner says it all).
    if !eval.weapon_already_out {
        if let Some((muid, mname, mat)) = most_recent {
            match user_uid {
                None => {
                    eval.suggested_user_uid = Some(muid);
                    eval.suggested_user_name = Some(mname);
                    // Don't autofill a user who already holds a weapon — warn instead.
                    eval.suggested_user_busy = user_has_open(conn, muid)?;
                }
                Some(uuid) if uuid != muid => {
                    eval.fresher_user_name = Some(mname);
                    eval.fresher_user_at = Some(mat);
                }
                _ => {}
            }
        }
    }

    // Symmetric autopopulate: member picked, weapon not → suggest member's most
    // recent weapon (unless it's currently out — then warn, don't autofill).
    if weapon_uid.is_none() {
        if let Some(uuid) = user_uid {
            if let Some((wuid, label)) = most_recent_weapon_for_user(conn, uuid)? {
                eval.suggested_weapon_uid = Some(wuid);
                eval.suggested_weapon_label = Some(label);
                eval.suggested_weapon_out = open_checkout_for(conn, wuid)?.is_some();
            }
        }
    }

    eval.can_checkout = weapon_uid.is_some()
        && user_uid.is_some()
        && !eval.weapon_inactive
        && !eval.user_inactive
        && !eval.weapon_already_out;

    Ok(eval)
}

fn do_checkout(
    conn: &Connection,
    weapon_uid: i64,
    user_uid: i64,
    operator_uid: i64,
    notes: Option<String>,
) -> Result<Checkout, AppError> {
    let w = weapon_get(conn, weapon_uid)?.ok_or_else(|| AppError::weapon_not_found(weapon_uid))?;
    if !w.active {
        return Err(AppError::weapon_inactive());
    }
    let u = user_get(conn, user_uid)?.ok_or_else(|| AppError::user_not_found(user_uid))?;
    if !u.active {
        return Err(AppError::user_inactive());
    }
    if open_checkout_for(conn, weapon_uid)?.is_some() {
        return Err(AppError::weapon_already_out());
    }

    let label = weapon_label(&w);
    conn.execute(
        "INSERT INTO checkouts
           (weapon_uid, user_uid, weapon_display_snapshot, weapon_label_snapshot,
            user_display_snapshot, user_name_snapshot, operator_out_uid, checked_out_at, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            weapon_uid,
            user_uid,
            w.display_id,
            label,
            u.display_id,
            u.name,
            operator_uid,
            now_utc(),
            norm(notes),
        ],
    )?;
    checkout_get(conn, conn.last_insert_rowid())?
        .ok_or_else(|| AppError::internal("inserted checkout not found"))
}

fn do_checkin(conn: &Connection, checkout_id: i64, operator_uid: i64) -> Result<Checkout, AppError> {
    let row =
        checkout_get(conn, checkout_id)?.ok_or_else(|| AppError::checkout_not_found(checkout_id))?;
    if row.checked_in_at.is_some() {
        return Err(AppError::already_checked_in());
    }
    conn.execute(
        "UPDATE checkouts SET checked_in_at = ?2, operator_in_uid = ?3 WHERE id = ?1",
        params![checkout_id, now_utc(), operator_uid],
    )?;
    checkout_get(conn, checkout_id)?.ok_or_else(|| AppError::checkout_not_found(checkout_id))
}

fn list_open(conn: &Connection) -> Result<Vec<OpenCheckout>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, weapon_uid, user_uid, weapon_display_snapshot, weapon_label_snapshot,
                user_display_snapshot, user_name_snapshot, checked_out_at
         FROM checkouts WHERE checked_in_at IS NULL
         ORDER BY checked_out_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(OpenCheckout {
            id: r.get(0)?,
            weapon_uid: r.get(1)?,
            user_uid: r.get(2)?,
            weapon_display: r.get(3)?,
            weapon_label: r.get(4)?,
            user_display: r.get(5)?,
            user_name: r.get(6)?,
            checked_out_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---------- Command wrappers ----------

#[tauri::command]
pub fn evaluate_checkout(
    db: State<Db>,
    weapon_uid: Option<i64>,
    user_uid: Option<i64>,
) -> Result<CheckoutEval, AppError> {
    let conn = lock(&db)?;
    evaluate(&conn, weapon_uid, user_uid)
}

#[tauri::command]
pub fn checkout(
    db: State<Db>,
    weapon_uid: i64,
    user_uid: i64,
    operator_uid: i64,
    notes: Option<String>,
) -> Result<Checkout, AppError> {
    let conn = lock(&db)?;
    do_checkout(&conn, weapon_uid, user_uid, operator_uid, notes)
}

#[tauri::command]
pub fn checkin(db: State<Db>, checkout_id: i64, operator_uid: i64) -> Result<Checkout, AppError> {
    let conn = lock(&db)?;
    do_checkin(&conn, checkout_id, operator_uid)
}

#[tauri::command]
pub fn list_open_checkouts(db: State<Db>) -> Result<Vec<OpenCheckout>, AppError> {
    let conn = lock(&db)?;
    list_open(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{user_create, user_set_active, weapon_create, weapon_set_active};
    use crate::db::migrated_in_memory;
    use crate::models::{NewUser, NewWeapon};

    fn mk_user(conn: &Connection, name: &str, display: &str, staff: bool) -> i64 {
        user_create(
            conn,
            NewUser {
                display_id: Some(display.into()),
                member_number: None,
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
                notes: None,
            },
        )
        .unwrap()
        .uid
    }

    #[test]
    fn checkout_writes_snapshots() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        let c = do_checkout(&conn, w, anna, op, None).unwrap();
        assert_eq!(c.weapon_display_snapshot.as_deref(), Some("W1"));
        assert_eq!(c.weapon_label_snapshot.as_deref(), Some("Glock 17 (S-W1)"));
        assert_eq!(c.user_display_snapshot.as_deref(), Some("10"));
        assert_eq!(c.user_name_snapshot.as_deref(), Some("Anna"));
        assert_eq!(c.operator_out_uid, op);
        assert!(c.checked_in_at.is_none());
    }

    #[test]
    fn already_out_blocks_and_checkin_frees() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let bjorn = mk_user(&conn, "Björn", "11", false);
        let w = mk_weapon(&conn, "W1");

        let c = do_checkout(&conn, w, anna, op, None).unwrap();

        let e = evaluate(&conn, Some(w), Some(bjorn)).unwrap();
        assert!(e.weapon_already_out);
        assert_eq!(e.open_holder_name.as_deref(), Some("Anna"));
        assert!(!e.can_checkout);

        assert!(do_checkout(&conn, w, bjorn, op, None).is_err());

        do_checkin(&conn, c.id, op).unwrap();
        let e = evaluate(&conn, Some(w), Some(bjorn)).unwrap();
        assert!(!e.weapon_already_out);
        assert!(e.can_checkout);

        // Second checkin fails.
        assert!(do_checkin(&conn, c.id, op).is_err());
    }

    #[test]
    fn suggestion_and_fresher_user() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let bjorn = mk_user(&conn, "Björn", "11", false);
        let w = mk_weapon(&conn, "W1");
        let fresh = mk_weapon(&conn, "W2");

        let c = do_checkout(&conn, w, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();

        // No user picked → suggest Anna, no fresher warning.
        let e = evaluate(&conn, Some(w), None).unwrap();
        assert_eq!(e.suggested_user_uid, Some(anna));
        assert_eq!(e.suggested_user_name.as_deref(), Some("Anna"));
        assert!(e.fresher_user_name.is_none());

        // Different user picked → fresher warning naming Anna.
        let e = evaluate(&conn, Some(w), Some(bjorn)).unwrap();
        assert_eq!(e.fresher_user_name.as_deref(), Some("Anna"));
        assert!(e.suggested_user_uid.is_none());

        // Same user picked → no warning, no suggestion.
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.fresher_user_name.is_none());
        assert!(e.suggested_user_uid.is_none());

        // Weapon with no history → neither.
        let e = evaluate(&conn, Some(fresh), None).unwrap();
        assert!(e.suggested_user_uid.is_none());
        assert!(e.fresher_user_name.is_none());
    }

    #[test]
    fn member_to_weapon_suggestion() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        // No history → no weapon suggestion.
        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert!(e.suggested_weapon_uid.is_none());

        let c = do_checkout(&conn, w, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();

        // Member picked, no weapon → suggest the member's last weapon (available).
        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.suggested_weapon_uid, Some(w));
        assert_eq!(e.suggested_weapon_label.as_deref(), Some("Glock 17 (S-W1)"));
        assert!(!e.suggested_weapon_out);

        // Weapon already picked → no weapon suggestion.
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.suggested_weapon_uid.is_none());

        // Member's last weapon now out → suggested but flagged, not to be autofilled.
        do_checkout(&conn, w, anna, op, None).unwrap();
        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.suggested_weapon_uid, Some(w));
        assert!(e.suggested_weapon_out);
    }

    #[test]
    fn suggested_user_busy_and_fresher_suppressed_when_out() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w1 = mk_weapon(&conn, "W1");
        let w2 = mk_weapon(&conn, "W2");

        // Anna used W1 (returned), then took W2 (still out).
        let c = do_checkout(&conn, w1, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();
        do_checkout(&conn, w2, anna, op, None).unwrap();

        // Picking W1, no user → suggests Anna but flags her busy (holds W2).
        let e = evaluate(&conn, Some(w1), None).unwrap();
        assert_eq!(e.suggested_user_uid, Some(anna));
        assert!(e.suggested_user_busy);

        // W2 is out; selecting it with another user → no fresher banner.
        let bjorn = mk_user(&conn, "Björn", "11", false);
        let e = evaluate(&conn, Some(w2), Some(bjorn)).unwrap();
        assert!(e.weapon_already_out);
        assert!(e.fresher_user_name.is_none());
    }

    #[test]
    fn inactive_weapon_and_user_block() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        weapon_set_active(&conn, w, false, Some("repair".into())).unwrap();
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.weapon_inactive);
        assert_eq!(e.weapon_inactive_reason.as_deref(), Some("repair"));
        assert!(!e.can_checkout);
        assert!(do_checkout(&conn, w, anna, op, None).is_err());

        weapon_set_active(&conn, w, true, None).unwrap();
        user_set_active(&conn, anna, false).unwrap();
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.user_inactive);
        assert!(!e.can_checkout);
        assert!(do_checkout(&conn, w, anna, op, None).is_err());
    }

    #[test]
    fn outstanding_debt_sums_unsettled() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);

        conn.execute(
            "INSERT INTO debts (user_uid, operator_uid, amount_kr, created_at) VALUES (?1,?2,?3,?4)",
            params![anna, op, 150, now_utc()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO debts (user_uid, operator_uid, amount_kr, created_at, settled_at) VALUES (?1,?2,?3,?4,?4)",
            params![anna, op, 999, now_utc()],
        )
        .unwrap();

        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.user_outstanding_debt_kr, 150);
    }
}
