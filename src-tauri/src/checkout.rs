//! Checkout / checkin: the core flow.
//!
//! `evaluate_checkout` computes everything the UI needs to autofill the weapon
//! and render notices (rules live here, not in JS). `checkout` re-validates
//! server-side and records only uids (weapon/user/operator); identity is resolved live by uid when
//! logs are read, so it always reflects current values. Logs are append-only:
//! checkin updates the open row's return fields; nothing is deleted.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::commands::{user_get, weapon_get};
use crate::db::Db;
use crate::error::AppError;

pub const CHECKOUT_COLS: &str = "id, weapon_uid, user_uid, operator_out_uid, checked_out_at, operator_in_uid, checked_in_at, notes";

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
    // Live identity (looked up by uid), composed for display by the frontend.
    pub user_name: Option<String>,
    pub user_display_id: Option<String>,
    pub user_active: bool,
    pub user_is_guest: bool,
    pub weapon_brand: Option<String>,
    pub weapon_model: Option<String>,
    pub weapon_serial: Option<String>,
    pub weapon_display_id: Option<String>,
    pub weapon_caliber: Option<String>,
    pub weapon_active: bool,
    pub checked_out_at: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutEval {
    /// Member's most-recent weapon, suggested when no weapon is picked yet.
    /// Identity resolved live by uid; composed for display by the frontend.
    pub suggested_weapon_uid: Option<i64>,
    pub suggested_weapon_brand: Option<String>,
    pub suggested_weapon_model: Option<String>,
    pub suggested_weapon_serial: Option<String>,
    pub suggested_weapon_display_id: Option<String>,
    pub suggested_weapon_caliber: Option<String>,
    pub suggested_weapon_active: bool,
    /// That suggested weapon is currently out → don't autofill, warn instead.
    pub suggested_weapon_out: bool,
    /// Member's most recent weapon uid — pinned as "last" in the weapon picker,
    /// independent of which weapon the suggestion picked.
    pub last_weapon_uid: Option<i64>,
    pub weapon_inactive: bool,
    pub weapon_inactive_reason: Option<String>,
    pub weapon_already_out: bool,
    pub open_holder_name: Option<String>,
    pub open_holder_display: Option<String>,
    pub open_holder_active: bool,
    pub open_checkout_id: Option<i64>,
    pub user_inactive: bool,
    pub user_outstanding_debt_kr: i64,
    pub can_checkout: bool,
    /// Active condition tags on the chosen weapon (fixed keys, e.g. "needs_service").
    /// Warn-only: tags never block checkout.
    pub weapon_tags: Vec<String>,
    pub weapon_tag_comment: Option<String>,
}

/// (checkout_id, holder_uid) if the weapon is currently out. The holder's
/// identity is resolved live by uid (snapshots are not used for display).
fn open_checkout_for(
    conn: &Connection,
    weapon_uid: i64,
) -> Result<Option<(i64, i64)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id, user_uid FROM checkouts
             WHERE weapon_uid = ?1 AND checked_in_at IS NULL
             ORDER BY id DESC LIMIT 1",
            params![weapon_uid],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .optional()?)
}

/// weapon_uid of the member's most recent checkout — for member→weapon
/// autopopulate (the weapon's identity is then resolved live by uid).
fn most_recent_weapon_uid_for_user(
    conn: &Connection,
    user_uid: i64,
) -> Result<Option<i64>, AppError> {
    Ok(conn
        .query_row(
            "SELECT weapon_uid FROM checkouts WHERE user_uid = ?1
             ORDER BY checked_out_at DESC, id DESC LIMIT 1",
            params![user_uid],
            |r| r.get::<_, i64>(0),
        )
        .optional()?)
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

    if let Some(wuid) = weapon_uid {
        if let Some(w) = weapon_get(conn, wuid)? {
            if w.tag_needs_service { eval.weapon_tags.push("needs_service".into()); }
            if w.tag_broken { eval.weapon_tags.push("broken".into()); }
            if w.tag_missing_parts { eval.weapon_tags.push("missing_parts".into()); }
            if w.tag_needs_cleaning { eval.weapon_tags.push("needs_cleaning".into()); }
            eval.weapon_tag_comment = w.tag_comment.clone();
            if !w.active {
                eval.weapon_inactive = true;
                eval.weapon_inactive_reason = w.inactive_reason;
            }
            if let Some((cid, holder_uid)) = open_checkout_for(conn, wuid)? {
                eval.weapon_already_out = true;
                eval.open_checkout_id = Some(cid);
                if let Some(h) = user_get(conn, holder_uid)? {
                    eval.open_holder_name = Some(h.name);
                    eval.open_holder_display = h.display_id;
                    eval.open_holder_active = h.active;
                }
            }
        }
    }

    if let Some(uuid) = user_uid {
        if let Some(u) = user_get(conn, uuid)? {
            eval.user_inactive = !u.active;
        }
        eval.user_outstanding_debt_kr = outstanding_debt(conn, uuid)?;
    }

    // Symmetric autopopulate: member picked, weapon not → suggest the member's
    // preferred weapon (when active and available), else their most recent one
    // (unless it's currently out — then warn, don't autofill).
    if weapon_uid.is_none() {
        if let Some(uuid) = user_uid {
            eval.last_weapon_uid = most_recent_weapon_uid_for_user(conn, uuid)?;
            let preferred = user_get(conn, uuid)?.and_then(|u| u.preferred_weapon_uid);
            let mut pick: Option<i64> = None;
            if let Some(puid) = preferred {
                if let Some(w) = weapon_get(conn, puid)? {
                    if w.active && open_checkout_for(conn, puid)?.is_none() {
                        pick = Some(puid);
                    }
                }
            }
            let pick = pick.or(eval.last_weapon_uid);
            if let Some(wuid) = pick {
                if let Some(w) = weapon_get(conn, wuid)? {
                    eval.suggested_weapon_uid = Some(wuid);
                    eval.suggested_weapon_brand = w.brand;
                    eval.suggested_weapon_model = w.model;
                    eval.suggested_weapon_serial = w.serial;
                    eval.suggested_weapon_display_id = w.display_id;
                    eval.suggested_weapon_caliber = w.caliber;
                    eval.suggested_weapon_active = w.active;
                    eval.suggested_weapon_out = open_checkout_for(conn, wuid)?.is_some();
                }
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

pub(crate) fn do_checkout(
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

    conn.execute(
        "INSERT INTO checkouts
           (weapon_uid, user_uid, operator_out_uid, checked_out_at, notes)
         VALUES (?1,?2,?3,?4,?5)",
        params![weapon_uid, user_uid, operator_uid, now_utc(), norm(notes)],
    )?;
    checkout_get(conn, conn.last_insert_rowid())?
        .ok_or_else(|| AppError::internal("inserted checkout not found"))
}

pub(crate) fn do_checkin(
    conn: &Connection,
    checkout_id: i64,
    operator_uid: i64,
) -> Result<Checkout, AppError> {
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
        "SELECT c.id, c.weapon_uid, c.user_uid,
                u.name, u.display_id, u.active, u.is_guest,
                w.brand, w.model, w.serial, w.active,
                c.checked_out_at, w.display_id, w.caliber
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         JOIN weapons w ON w.uid = c.weapon_uid
         WHERE c.checked_in_at IS NULL
         ORDER BY c.checked_out_at DESC, c.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(OpenCheckout {
            id: r.get(0)?,
            weapon_uid: r.get(1)?,
            user_uid: r.get(2)?,
            user_name: r.get(3)?,
            user_display_id: r.get(4)?,
            user_active: r.get(5)?,
            user_is_guest: r.get(6)?,
            weapon_brand: r.get(7)?,
            weapon_model: r.get(8)?,
            weapon_serial: r.get(9)?,
            weapon_active: r.get(10)?,
            checked_out_at: r.get(11)?,
            weapon_display_id: r.get(12)?,
            weapon_caliber: r.get(13)?,
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
    use crate::commands::{
        user_create, user_set_active, user_set_preferred_weapon, weapon_create, weapon_set_active,
    };
    use crate::db::migrated_in_memory;
    use crate::models::{NewUser, NewWeapon};

    fn mk_user(conn: &Connection, name: &str, display: &str, staff: bool) -> i64 {
        user_create(
            conn,
            NewUser {
                display_id: Some(display.into()),
                name: name.into(),
                email: None,
                phone: None,
                address: None,
                ssn: None,
                is_staff: staff,
                is_admin: false,
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
    fn checkout_records_core_fields() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        let c = do_checkout(&conn, w, anna, op, None).unwrap();
        assert_eq!(c.weapon_uid, w);
        assert_eq!(c.user_uid, anna);
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
        assert_eq!(e.suggested_weapon_brand.as_deref(), Some("Glock"));
        assert_eq!(e.suggested_weapon_serial.as_deref(), Some("S-W1"));
        assert_eq!(e.suggested_weapon_display_id.as_deref(), Some("W1"));
        assert!(e.suggested_weapon_active);
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
    fn inactive_weapon_and_user_block() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        weapon_set_active(&conn, w, false, Some("repair".into()), false).unwrap();
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.weapon_inactive);
        assert_eq!(e.weapon_inactive_reason.as_deref(), Some("repair"));
        assert!(!e.can_checkout);
        assert!(do_checkout(&conn, w, anna, op, None).is_err());

        weapon_set_active(&conn, w, true, None, false).unwrap();
        user_set_active(&conn, anna, false, false).unwrap();
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.user_inactive);
        assert!(!e.can_checkout);
        assert!(do_checkout(&conn, w, anna, op, None).is_err());
    }

    #[test]
    fn preferred_weapon_suggested_over_last_used() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w_last = mk_weapon(&conn, "W1");
        let w_pref = mk_weapon(&conn, "W2");

        let c = do_checkout(&conn, w_last, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();
        user_set_preferred_weapon(&conn, anna, Some(w_pref)).unwrap();

        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.suggested_weapon_uid, Some(w_pref));
        assert!(!e.suggested_weapon_out);
        // Last-used is exposed separately so the picker can pin both.
        assert_eq!(e.last_weapon_uid, Some(w_last));
    }

    #[test]
    fn preferred_weapon_falls_back_when_out_or_inactive() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let bjorn = mk_user(&conn, "Björn", "11", false);
        let w_last = mk_weapon(&conn, "W1");
        let w_pref = mk_weapon(&conn, "W2");

        let c = do_checkout(&conn, w_last, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();
        user_set_preferred_weapon(&conn, anna, Some(w_pref)).unwrap();

        // Preferred weapon out (held by Björn) → fall back to last-used.
        do_checkout(&conn, w_pref, bjorn, op, None).unwrap();
        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.suggested_weapon_uid, Some(w_last));

        // Preferred weapon inactive → fall back too. (Deactivation is allowed
        // after the preference was set; only *setting* requires an active weapon.)
        let c2 = open_checkout_for(&conn, w_pref).unwrap().unwrap();
        do_checkin(&conn, c2.0, op).unwrap();
        weapon_set_active(&conn, w_pref, false, Some("repair".into()), false).unwrap();
        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.suggested_weapon_uid, Some(w_last));
    }

    #[test]
    fn last_weapon_uid_exposed_without_preference() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", "1", true);
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");
        let c = do_checkout(&conn, w, anna, op, None).unwrap();
        do_checkin(&conn, c.id, op).unwrap();

        let e = evaluate(&conn, None, Some(anna)).unwrap();
        assert_eq!(e.last_weapon_uid, Some(w));
        assert_eq!(e.suggested_weapon_uid, Some(w));
    }

    #[test]
    fn eval_reports_weapon_tags() {
        let conn = migrated_in_memory();
        let anna = mk_user(&conn, "Anna", "10", false);
        let w = mk_weapon(&conn, "W1");

        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert!(e.weapon_tags.is_empty());

        crate::commands::weapon_set_tags(&conn, w, true, true, false, false, Some("obs".into())).unwrap();
        let e = evaluate(&conn, Some(w), Some(anna)).unwrap();
        assert_eq!(e.weapon_tags, vec!["needs_service".to_string(), "broken".to_string()]);
        assert_eq!(e.weapon_tag_comment.as_deref(), Some("obs"));
        // Tags warn, never block.
        assert!(e.can_checkout);
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
