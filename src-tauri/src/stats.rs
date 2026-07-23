use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub loan_count: i64,
    pub member_count: i64,
    pub guest_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanBucket {
    pub bucket: String,
    pub count: i64,
}

fn summary(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<StatsSummary, AppError> {
    let row = conn.query_row(
        "SELECT COUNT(*),
                COUNT(DISTINCT CASE WHEN u.is_guest = 0 THEN c.user_uid END),
                COUNT(DISTINCT CASE WHEN u.is_guest = 1 THEN c.user_uid END)
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         WHERE (?1 IS NULL OR c.checked_out_at >= ?1)
           AND (?2 IS NULL OR c.checked_out_at < ?2)",
        rusqlite::params![from, to],
        |r| {
            Ok(StatsSummary {
                loan_count: r.get(0)?,
                member_count: r.get(1)?,
                guest_count: r.get(2)?,
            })
        },
    )?;
    Ok(row)
}

fn loans_buckets(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    bucket: &str,
) -> Result<Vec<LoanBucket>, AppError> {
    let fmt = match bucket {
        "hour" => "%H",
        "day" => "%Y-%m-%d",
        "month" => "%Y-%m",
        "year" => "%Y",
        other => return Err(AppError::internal(format!("unknown bucket: {other}"))),
    };
    let sql = format!(
        "SELECT strftime('{fmt}', c.checked_out_at, 'localtime') AS b, COUNT(*)
         FROM checkouts c
         WHERE (?1 IS NULL OR c.checked_out_at >= ?1)
           AND (?2 IS NULL OR c.checked_out_at < ?2)
         GROUP BY b
         ORDER BY b"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params![from, to], |r| {
            Ok(LoanBucket { bucket: r.get(0)?, count: r.get(1)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn stats_summary(
    db: State<Db>,
    from: Option<String>,
    to: Option<String>,
) -> Result<StatsSummary, AppError> {
    let conn = lock(&db)?;
    summary(&conn, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub fn stats_loans_buckets(
    db: State<Db>,
    from: Option<String>,
    to: Option<String>,
    bucket: String,
) -> Result<Vec<LoanBucket>, AppError> {
    let conn = lock(&db)?;
    loans_buckets(&conn, from.as_deref(), to.as_deref(), &bucket)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponUsage {
    pub weapon_uid: i64,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub caliber: Option<String>,
    pub display_id: Option<String>,
    pub active: bool,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberActivity {
    pub user_uid: i64,
    pub name: String,
    pub is_guest: bool,
    pub active: bool,
    pub count: i64,
}

fn weapon_usage(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<WeaponUsage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.weapon_uid, w.brand, w.model, w.caliber, w.display_id, w.active,
                COUNT(*) AS cnt
         FROM checkouts c
         JOIN weapons w ON w.uid = c.weapon_uid
         WHERE (?1 IS NULL OR c.checked_out_at >= ?1)
           AND (?2 IS NULL OR c.checked_out_at < ?2)
         GROUP BY c.weapon_uid
         ORDER BY cnt DESC, CAST(w.display_id AS INTEGER)",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![from, to], |r| {
            Ok(WeaponUsage {
                weapon_uid: r.get(0)?,
                brand: r.get(1)?,
                model: r.get(2)?,
                caliber: r.get(3)?,
                display_id: r.get(4)?,
                active: r.get(5)?,
                count: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn member_activity(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<MemberActivity>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.user_uid, u.name, u.is_guest, u.active, COUNT(*) AS cnt
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         WHERE (?1 IS NULL OR c.checked_out_at >= ?1)
           AND (?2 IS NULL OR c.checked_out_at < ?2)
         GROUP BY c.user_uid
         ORDER BY cnt DESC, u.name",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![from, to], |r| {
            Ok(MemberActivity {
                user_uid: r.get(0)?,
                name: r.get(1)?,
                is_guest: r.get(2)?,
                active: r.get(3)?,
                count: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn stats_weapon_usage(
    db: State<Db>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<WeaponUsage>, AppError> {
    let conn = lock(&db)?;
    weapon_usage(&conn, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub fn stats_member_activity(
    db: State<Db>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<MemberActivity>, AppError> {
    let conn = lock(&db)?;
    member_activity(&conn, from.as_deref(), to.as_deref())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleAssignment {
    pub user_uid: i64,
    pub name: String,
    pub weapon_uid: i64,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub caliber: Option<String>,
    pub display_id: Option<String>,
    pub weapon_active: bool,
    pub last_used: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeverBorrowedWeapon {
    pub weapon_uid: i64,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub caliber: Option<String>,
    pub display_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedWeapon {
    pub weapon_uid: i64,
    pub brand: Option<String>,
    pub model: Option<String>,
    pub caliber: Option<String>,
    pub display_id: Option<String>,
    pub tag_needs_service: bool,
    pub tag_broken: bool,
    pub tag_missing_parts: bool,
    pub tag_needs_cleaning: bool,
    pub tag_comment: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestRow {
    pub user_uid: i64,
    pub name: String,
    pub loan_count: i64,
    pub last_visit: Option<String>,
}

fn stale_assignments(conn: &Connection, months: i64) -> Result<Vec<StaleAssignment>, AppError> {
    let cutoff = chrono::Utc::now()
        .checked_sub_months(chrono::Months::new(months.clamp(1, 120) as u32))
        .ok_or_else(|| AppError::internal("cutoff overflow"))?
        .to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT * FROM (
           SELECT u.uid AS user_uid, u.name,
                  w.uid AS weapon_uid, w.brand, w.model, w.caliber, w.display_id,
                  w.active AS weapon_active,
                  (SELECT MAX(c.checked_out_at) FROM checkouts c
                    WHERE c.user_uid = u.uid AND c.weapon_uid = u.preferred_weapon_uid) AS last_used
           FROM users u
           JOIN weapons w ON w.uid = u.preferred_weapon_uid
           WHERE u.active = 1 AND u.is_guest = 0
         )
         WHERE last_used IS NULL OR last_used < ?1
         ORDER BY last_used IS NULL DESC, last_used",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![cutoff], |r| {
            Ok(StaleAssignment {
                user_uid: r.get(0)?,
                name: r.get(1)?,
                weapon_uid: r.get(2)?,
                brand: r.get(3)?,
                model: r.get(4)?,
                caliber: r.get(5)?,
                display_id: r.get(6)?,
                weapon_active: r.get(7)?,
                last_used: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn never_borrowed(conn: &Connection) -> Result<Vec<NeverBorrowedWeapon>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT w.uid, w.brand, w.model, w.caliber, w.display_id, w.created_at
         FROM weapons w
         WHERE w.active = 1
           AND NOT EXISTS (SELECT 1 FROM checkouts c WHERE c.weapon_uid = w.uid)
         ORDER BY CAST(w.display_id AS INTEGER)",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(NeverBorrowedWeapon {
                weapon_uid: r.get(0)?,
                brand: r.get(1)?,
                model: r.get(2)?,
                caliber: r.get(3)?,
                display_id: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn tagged_weapons(conn: &Connection) -> Result<Vec<TaggedWeapon>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT w.uid, w.brand, w.model, w.caliber, w.display_id,
                w.tag_needs_service, w.tag_broken, w.tag_missing_parts,
                w.tag_needs_cleaning, w.tag_comment
         FROM weapons w
         WHERE w.active = 1
           AND (w.tag_needs_service = 1 OR w.tag_broken = 1 OR w.tag_missing_parts = 1
                OR w.tag_needs_cleaning = 1
                OR (w.tag_comment IS NOT NULL AND w.tag_comment != ''))
         ORDER BY CAST(w.display_id AS INTEGER)",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TaggedWeapon {
                weapon_uid: r.get(0)?,
                brand: r.get(1)?,
                model: r.get(2)?,
                caliber: r.get(3)?,
                display_id: r.get(4)?,
                tag_needs_service: r.get(5)?,
                tag_broken: r.get(6)?,
                tag_missing_parts: r.get(7)?,
                tag_needs_cleaning: r.get(8)?,
                tag_comment: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn guest_rows(conn: &Connection) -> Result<Vec<GuestRow>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT u.uid, u.name,
                (SELECT COUNT(*) FROM checkouts c WHERE c.user_uid = u.uid) AS cnt,
                (SELECT MAX(c.checked_out_at) FROM checkouts c WHERE c.user_uid = u.uid) AS last_visit
         FROM users u
         WHERE u.active = 1 AND u.is_guest = 1
         ORDER BY cnt DESC, u.name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GuestRow {
                user_uid: r.get(0)?,
                name: r.get(1)?,
                loan_count: r.get(2)?,
                last_visit: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn maintenance_stale_assignments(
    db: State<Db>,
    months: i64,
) -> Result<Vec<StaleAssignment>, AppError> {
    let conn = lock(&db)?;
    stale_assignments(&conn, months)
}

#[tauri::command]
pub fn maintenance_never_borrowed(db: State<Db>) -> Result<Vec<NeverBorrowedWeapon>, AppError> {
    let conn = lock(&db)?;
    never_borrowed(&conn)
}

#[tauri::command]
pub fn maintenance_tagged_weapons(db: State<Db>) -> Result<Vec<TaggedWeapon>, AppError> {
    let conn = lock(&db)?;
    tagged_weapons(&conn)
}

#[tauri::command]
pub fn maintenance_guests(db: State<Db>) -> Result<Vec<GuestRow>, AppError> {
    let conn = lock(&db)?;
    guest_rows(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;
    use rusqlite::params;

    pub(crate) fn mk_user(conn: &Connection, name: &str, guest: bool) -> i64 {
        conn.execute(
            "INSERT INTO users (name, is_staff, is_guest, created_at, updated_at)
             VALUES (?1, 0, ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![name, guest as i64],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    pub(crate) fn mk_weapon(conn: &Connection, tag: &str) -> i64 {
        conn.execute(
            "INSERT INTO weapons (display_id, brand, model, created_at, updated_at)
             VALUES (?1, 'Glock', '17', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![tag],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    pub(crate) fn ins_checkout(
        conn: &Connection,
        weapon: i64,
        user: i64,
        operator: i64,
        out_at: &str,
        in_at: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO checkouts (weapon_uid, user_uid, operator_out_uid,
                                    checked_out_at, operator_in_uid, checked_in_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![weapon, user, operator, out_at, in_at.map(|_| operator), in_at],
        )
        .unwrap();
    }

    #[test]
    fn summary_counts_and_period_filter() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let guest = mk_user(&conn, "Gäst", true);
        let w = mk_weapon(&conn, "1");
        // two loans in June, one in July; Anna twice, guest once
        ins_checkout(&conn, w, anna, op, "2026-06-10T12:00:00Z", Some("2026-06-10T13:00:00Z"));
        ins_checkout(&conn, w, guest, op, "2026-06-20T12:00:00Z", Some("2026-06-20T13:00:00Z"));
        ins_checkout(&conn, w, anna, op, "2026-07-05T12:00:00Z", None);

        let all = summary(&conn, None, None).unwrap();
        assert_eq!((all.loan_count, all.member_count, all.guest_count), (3, 1, 1));

        let june = summary(&conn, Some("2026-06-01T00:00:00Z"), Some("2026-07-01T00:00:00Z")).unwrap();
        assert_eq!((june.loan_count, june.member_count, june.guest_count), (2, 1, 1));

        let july = summary(&conn, Some("2026-07-01T00:00:00Z"), None).unwrap();
        assert_eq!((july.loan_count, july.member_count, july.guest_count), (1, 1, 0));
    }

    #[test]
    fn buckets_group_and_reject_bad_bucket() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let w = mk_weapon(&conn, "1");
        // mid-day UTC timestamps so local-time bucketing lands on the same date in any TZ
        ins_checkout(&conn, w, anna, op, "2026-06-10T12:00:00Z", None);
        ins_checkout(&conn, w, anna, op, "2026-06-10T12:30:00Z", None);
        ins_checkout(&conn, w, anna, op, "2026-06-11T12:00:00Z", None);

        let days = loans_buckets(&conn, None, None, "day").unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!((days[0].bucket.as_str(), days[0].count), ("2026-06-10", 2));
        assert_eq!((days[1].bucket.as_str(), days[1].count), ("2026-06-11", 1));

        let months = loans_buckets(&conn, None, None, "month").unwrap();
        assert_eq!((months[0].bucket.as_str(), months[0].count), ("2026-06", 3));

        let years = loans_buckets(&conn, None, None, "year").unwrap();
        assert_eq!((years[0].bucket.as_str(), years[0].count), ("2026", 3));

        // same-hour grouping (both 12:xx UTC → same local hour bucket)
        let hours = loans_buckets(&conn, Some("2026-06-10T00:00:00Z"), Some("2026-06-11T00:00:00Z"), "hour").unwrap();
        assert_eq!(hours.len(), 1);
        assert_eq!(hours[0].count, 2);

        assert!(loans_buckets(&conn, None, None, "fortnight").is_err());
    }

    #[test]
    fn weapon_usage_sorted_and_filtered() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let w1 = mk_weapon(&conn, "1");
        let w2 = mk_weapon(&conn, "2");
        ins_checkout(&conn, w1, anna, op, "2026-06-10T12:00:00Z", None);
        ins_checkout(&conn, w2, anna, op, "2026-06-11T12:00:00Z", None);
        ins_checkout(&conn, w2, anna, op, "2026-06-12T12:00:00Z", None);

        let rows = weapon_usage(&conn, None, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].weapon_uid, rows[0].count), (w2, 2));
        assert_eq!((rows[1].weapon_uid, rows[1].count), (w1, 1));
        assert_eq!(rows[0].brand.as_deref(), Some("Glock"));

        let june12 = weapon_usage(&conn, Some("2026-06-12T00:00:00Z"), None).unwrap();
        assert_eq!(june12.len(), 1);
        assert_eq!(june12[0].count, 1);
    }

    #[test]
    fn member_activity_sorted_with_guest_flag() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let guest = mk_user(&conn, "Gäst", true);
        let w = mk_weapon(&conn, "1");
        ins_checkout(&conn, w, guest, op, "2026-06-10T12:00:00Z", None);
        ins_checkout(&conn, w, anna, op, "2026-06-11T12:00:00Z", None);
        ins_checkout(&conn, w, anna, op, "2026-06-12T12:00:00Z", None);

        let rows = member_activity(&conn, None, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].name.as_str(), rows[0].count, rows[0].is_guest), ("Anna", 2, false));
        assert_eq!((rows[1].name.as_str(), rows[1].count, rows[1].is_guest), ("Gäst", 1, true));
    }

    fn set_pref(conn: &Connection, user: i64, weapon: i64) {
        conn.execute(
            "UPDATE users SET preferred_weapon_uid = ?2 WHERE uid = ?1",
            params![user, weapon],
        )
        .unwrap();
    }

    #[test]
    fn stale_assignments_never_and_old_only() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);   // used assigned weapon recently
        let bjorn = mk_user(&conn, "Björn", false); // used assigned weapon long ago
        let cilla = mk_user(&conn, "Cilla", false); // never used assigned weapon
        let w1 = mk_weapon(&conn, "1");
        let w2 = mk_weapon(&conn, "2");
        let w3 = mk_weapon(&conn, "3");
        set_pref(&conn, anna, w1);
        set_pref(&conn, bjorn, w2);
        set_pref(&conn, cilla, w3);
        let recent = chrono::Utc::now().to_rfc3339();
        ins_checkout(&conn, w1, anna, op, &recent, None);
        ins_checkout(&conn, w2, bjorn, op, "2020-01-10T12:00:00Z", None);
        // Cilla borrowed ANOTHER weapon recently — still stale on her own
        ins_checkout(&conn, w1, cilla, op, &recent, None);

        let rows = stale_assignments(&conn, 3).unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["Cilla", "Björn"]); // never-used first, then oldest
        assert!(rows[0].last_used.is_none());
        assert!(rows[1].last_used.is_some());
    }

    #[test]
    fn never_borrowed_excludes_borrowed_and_inactive() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let used = mk_weapon(&conn, "1");
        let fresh = mk_weapon(&conn, "2");
        let retired = mk_weapon(&conn, "3");
        conn.execute("UPDATE weapons SET active = 0 WHERE uid = ?1", params![retired]).unwrap();
        ins_checkout(&conn, used, anna, op, "2026-06-10T12:00:00Z", None);

        let rows = never_borrowed(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].weapon_uid, fresh);
    }

    #[test]
    fn tagged_weapons_flags_or_comment() {
        let conn = migrated_in_memory();
        let clean = mk_weapon(&conn, "1");
        let flagged = mk_weapon(&conn, "2");
        let commented = mk_weapon(&conn, "3");
        conn.execute("UPDATE weapons SET tag_broken = 1 WHERE uid = ?1", params![flagged]).unwrap();
        conn.execute("UPDATE weapons SET tag_comment = 'Kolven glappar' WHERE uid = ?1", params![commented]).unwrap();

        let rows = tagged_weapons(&conn).unwrap();
        let uids: Vec<i64> = rows.iter().map(|r| r.weapon_uid).collect();
        assert_eq!(uids, vec![flagged, commented]);
        assert!(!uids.contains(&clean));
    }

    #[test]
    fn guest_rows_counts_and_sorts() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let g1 = mk_user(&conn, "Gäst Ett", true);
        let g2 = mk_user(&conn, "Gäst Två", true);
        let inactive_guest = mk_user(&conn, "Borta", true);
        conn.execute("UPDATE users SET active = 0 WHERE uid = ?1", params![inactive_guest]).unwrap();
        let w = mk_weapon(&conn, "1");
        ins_checkout(&conn, w, g2, op, "2026-06-10T12:00:00Z", Some("2026-06-10T13:00:00Z"));
        ins_checkout(&conn, w, g2, op, "2026-06-20T12:00:00Z", Some("2026-06-20T13:00:00Z"));

        let rows = guest_rows(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].name.as_str(), rows[0].loan_count), ("Gäst Två", 2));
        assert_eq!(rows[0].last_visit.as_deref(), Some("2026-06-20T12:00:00Z"));
        assert_eq!((rows[1].name.as_str(), rows[1].loan_count), ("Gäst Ett", 0));
        assert!(rows[1].last_visit.is_none());
    }
}
