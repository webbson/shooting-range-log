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
}
