# Statistics + Maintenance Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new nav pages — Statistik (loan stats over preset periods, CSS bar chart, CSV exports) and Underhåll (stale assignments with fast unassign, never-borrowed weapons, tagged weapons, guest promote list).

**Architecture:** New backend module `src-tauri/src/stats.rs` (read-only aggregate queries + one CSV-writing command), following the existing module pattern: inner fns take `&Connection` and are cargo-tested against `db::migrated_in_memory()`; thin `#[tauri::command]` wrappers registered in `lib.rs`. Frontend: two new pages + api wrappers + one export hook. No schema change, no new dependency.

**Tech Stack:** Tauri 2 / rusqlite / chrono · React + TS + Mantine v9 · TanStack Query · dayjs · @tauri-apps/plugin-dialog (`save`, already installed + permitted).

**Spec:** `docs/superpowers/specs/2026-07-23-stats-maintenance-design.md`

## Global Constraints

- No new dependencies (package.json and Cargo.toml unchanged except nothing).
- No schema change, no new migration. Log tables stay append-only.
- All user-facing strings via i18n keys in `src/i18n.ts`, **both `sv` and `en`**.
- CSV format: UTF-8 BOM (`\u{FEFF}`), `;` separator, CRLF line ends, **Swedish** headers regardless of UI language, fields quoted when containing `;`/`"`/newline. Timestamps `YYYY-MM-DD HH:MM` local time. Kronor plain integers.
- Tauri arg bridge: JS camelCase → Rust snake_case. Struct-less commands take flat params.
- Every new command registered in `lib.rs` `generate_handler!`.
- Gates before done: `cargo test --manifest-path src-tauri/Cargo.toml` green, `npm run build` green.
- Work on branch `feat/stats-maintenance`.
- Bucket SQL uses `strftime(fmt, checked_out_at, 'localtime')` — fmt from a Rust whitelist match, never from caller input (no SQL injection path).
- Period filtering everywhere: `(?from IS NULL OR checked_out_at >= ?from) AND (?to IS NULL OR checked_out_at < ?to)` on full RFC3339 UTC strings (string compare is chronological for UTC RFC3339).

---

### Task 1: Branch + stats module — summary & buckets

**Files:**
- Create: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod stats;` + 2 handler entries)

**Interfaces:**
- Consumes: `db::migrated_in_memory()`, `error::AppError`, lock helper — copy the `use` block from the top of `src-tauri/src/logs.rs` (it brings `Connection`, `State`, `Db`, `lock`, `AppError`, `Serialize`).
- Produces (later tasks rely on): `pub struct StatsSummary { loan_count, member_count, guest_count: i64 }` (serde camelCase), `pub struct LoanBucket { bucket: String, count: i64 }`, commands `stats_summary(from: Option<String>, to: Option<String>)`, `stats_loans_buckets(from, to, bucket: String)` with `bucket ∈ hour|day|month|year`. Test helpers `mk_user`, `mk_weapon`, `ins_checkout` (reused by Tasks 2–4 tests).

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/stats-maintenance
```

- [ ] **Step 2: Create `src-tauri/src/stats.rs` with structs, fn skeletons (`todo!()` bodies), and tests**

Copy the `use` block from `src-tauri/src/logs.rs` top, then:

```rust
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
    todo!()
}

fn loans_buckets(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    bucket: &str,
) -> Result<Vec<LoanBucket>, AppError> {
    todo!()
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
```

- [ ] **Step 3: Register module + commands in `src-tauri/src/lib.rs`**

Add `mod stats;` to the mod list (alphabetical, after `mod settings;`). In `generate_handler![...]` after `logs::last_weapon_users,` add:

```rust
    stats::stats_summary,
    stats::stats_loans_buckets,
```

- [ ] **Step 4: Run tests — expect FAIL (todo! panics)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml stats`
Expected: the two new tests FAIL with `not yet implemented`.

- [ ] **Step 5: Implement `summary` and `loans_buckets`**

```rust
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
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass (77 existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "feat(stats): stats module with summary and loan-bucket queries"
```

---

### Task 2: Weapon usage + member activity queries

**Files:**
- Modify: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/lib.rs` (2 handler entries)

**Interfaces:**
- Consumes: Task 1 test helpers `mk_user`/`mk_weapon`/`ins_checkout`.
- Produces: `pub struct WeaponUsage { weapon_uid: i64, brand/model/caliber/display_id: Option<String>, active: bool, count: i64 }`, `pub struct MemberActivity { user_uid: i64, name: String, is_guest: bool, active: bool, count: i64 }` (both serde camelCase); commands `stats_weapon_usage(from, to)`, `stats_member_activity(from, to)`; inner fns `weapon_usage(...)`, `member_activity(...)` (reused by CSV Task 4).

- [ ] **Step 1: Add structs, `todo!()` fns, wrappers, tests to `stats.rs`**

```rust
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
    todo!()
}

fn member_activity(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<MemberActivity>, AppError> {
    todo!()
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
```

Tests (inside `mod tests`):

```rust
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
```

- [ ] **Step 2: Register in `lib.rs`** — after `stats::stats_loans_buckets,` add:

```rust
    stats::stats_weapon_usage,
    stats::stats_member_activity,
```

- [ ] **Step 3: Run — expect FAIL** (`cargo test --manifest-path src-tauri/Cargo.toml stats`, `not yet implemented`)

- [ ] **Step 4: Implement**

```rust
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
```

- [ ] **Step 5: Run — expect PASS** (`cargo test --manifest-path src-tauri/Cargo.toml`)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "feat(stats): weapon usage and member activity queries"
```

---

### Task 3: Maintenance queries (stale, never-borrowed, tagged, guests)

**Files:**
- Modify: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/lib.rs` (4 handler entries)

**Interfaces:**
- Consumes: Task 1 helpers. `users.preferred_weapon_uid`, weapon `tag_*` columns (see db.rs SCHEMA_V3/V4).
- Produces (serde camelCase structs + commands):
  - `StaleAssignment { user_uid, name, weapon_uid, brand, model, caliber, display_id, weapon_active, last_used: Option<String> }`, command `maintenance_stale_assignments(months: i64)`
  - `NeverBorrowedWeapon { weapon_uid, brand, model, caliber, display_id, created_at }`, command `maintenance_never_borrowed()`
  - `TaggedWeapon { weapon_uid, brand, model, caliber, display_id, tag_needs_service, tag_broken, tag_missing_parts, tag_needs_cleaning: bool, tag_comment: Option<String> }`, command `maintenance_tagged_weapons()`
  - `GuestRow { user_uid, name, loan_count: i64, last_visit: Option<String> }`, command `maintenance_guests()`
  - Inner fns `stale_assignments(conn, months)`, `never_borrowed(conn)`, `tagged_weapons(conn)`, `guest_rows(conn)` (reused by CSV Task 4).

- [ ] **Step 1: Add structs, `todo!()` fns, wrappers, tests**

```rust
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
    todo!()
}
fn never_borrowed(conn: &Connection) -> Result<Vec<NeverBorrowedWeapon>, AppError> {
    todo!()
}
fn tagged_weapons(conn: &Connection) -> Result<Vec<TaggedWeapon>, AppError> {
    todo!()
}
fn guest_rows(conn: &Connection) -> Result<Vec<GuestRow>, AppError> {
    todo!()
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
```

Tests (inside `mod tests`; helper `set_pref` local to tests):

```rust
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
```

- [ ] **Step 2: Register in `lib.rs`** — after `stats::stats_member_activity,` add:

```rust
    stats::maintenance_stale_assignments,
    stats::maintenance_never_borrowed,
    stats::maintenance_tagged_weapons,
    stats::maintenance_guests,
```

- [ ] **Step 3: Run — expect FAIL** (4 new tests, `not yet implemented`)

- [ ] **Step 4: Implement**

```rust
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
```

- [ ] **Step 5: Run — expect PASS** (`cargo test --manifest-path src-tauri/Cargo.toml`)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "feat(stats): maintenance queries (stale assignments, never borrowed, tagged, guests)"
```

---

### Task 4: CSV export command

**Files:**
- Modify: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/lib.rs` (1 handler entry)

**Interfaces:**
- Consumes: inner query fns from Tasks 1–3.
- Produces: command `export_csv(kind: String, from: Option<String>, to: Option<String>, months: Option<i64>, path: String) -> Result<i64, AppError>` (returns data-row count). `kind ∈ loans_raw | weapon_usage | member_activity | debts | stale_assignments | guests`. Inner fn `csv_content(conn, kind, from, to, months) -> Result<(String, i64), AppError>` (tested without touching disk).

- [ ] **Step 1: Add helpers, `todo!()` `csv_content`, wrapper, tests**

```rust
fn csv_field(s: &str) -> String {
    if s.contains(';') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn csv_join(rows: &[Vec<String>]) -> String {
    let mut out = String::from("\u{FEFF}");
    for r in rows {
        out.push_str(&r.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(";"));
        out.push_str("\r\n");
    }
    out
}

/// RFC3339 UTC -> local "YYYY-MM-DD HH:MM" for humans in Excel.
fn fmt_local(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn weapon_name(brand: &Option<String>, model: &Option<String>, caliber: &Option<String>) -> String {
    let mut s = [brand.as_deref(), model.as_deref()]
        .iter()
        .flatten()
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(c) = caliber.as_deref() {
        if !c.is_empty() {
            s = format!("{s}, {c}");
        }
    }
    s
}

fn csv_content(
    conn: &Connection,
    kind: &str,
    from: Option<&str>,
    to: Option<&str>,
    months: Option<i64>,
) -> Result<(String, i64), AppError> {
    todo!()
}

#[tauri::command]
pub fn export_csv(
    db: State<Db>,
    kind: String,
    from: Option<String>,
    to: Option<String>,
    months: Option<i64>,
    path: String,
) -> Result<i64, AppError> {
    let conn = lock(&db)?;
    let (content, count) = csv_content(&conn, &kind, from.as_deref(), to.as_deref(), months)?;
    std::fs::write(&path, content)?;
    Ok(count)
}
```

Tests:

```rust
    #[test]
    fn csv_loans_raw_format() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "An;na", false); // ; forces quoting
        let w = mk_weapon(&conn, "1");
        ins_checkout(&conn, w, anna, op, "2026-06-10T12:00:00Z", Some("2026-06-10T13:00:00Z"));

        let (content, count) = csv_content(&conn, "loans_raw", None, None, None).unwrap();
        assert_eq!(count, 1);
        assert!(content.starts_with('\u{FEFF}'));
        let lines: Vec<&str> = content.trim_start_matches('\u{FEFF}').split("\r\n").collect();
        assert_eq!(
            lines[0],
            "Utlämnad;Återlämnad;Vapen-ID;Vapen;Serienummer;Låntagare;Gäst;Utlämnad av;Mottagen av"
        );
        assert!(lines[1].contains("\"An;na\""));
        assert!(lines[1].contains(";Nej;"));
        assert!(lines[1].contains("2026-06-10")); // local-formatted timestamp
    }

    #[test]
    fn csv_kinds_and_bad_kind() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", false);
        let anna = mk_user(&conn, "Anna", false);
        let w = mk_weapon(&conn, "1");
        ins_checkout(&conn, w, anna, op, "2026-06-10T12:00:00Z", None);
        conn.execute(
            "INSERT INTO debts (user_uid, operator_uid, amount_kr, reason, created_at)
             VALUES (?1, ?2, 150, 'ammo', '2026-06-10T12:00:00Z')",
            params![anna, op],
        )
        .unwrap();

        for kind in ["weapon_usage", "member_activity", "debts", "stale_assignments", "guests"] {
            let (content, _) = csv_content(&conn, kind, None, None, Some(3)).unwrap();
            assert!(content.starts_with('\u{FEFF}'), "{kind} missing BOM");
            assert!(content.contains(';'), "{kind} not ;-separated");
        }
        let (debts_csv, dc) = csv_content(&conn, "debts", None, None, None).unwrap();
        assert_eq!(dc, 1);
        assert!(debts_csv.contains("Anna;150"));

        assert!(csv_content(&conn, "nonsense", None, None, None).is_err());
    }
```

Note: check the `debts` DDL in `src-tauri/src/db.rs:96-110` before writing the INSERT — if column names differ (e.g. `note` vs `reason`, extra NOT NULL columns), adapt the test INSERT to the real columns. Do not touch the schema.

- [ ] **Step 2: Register in `lib.rs`** — after `stats::maintenance_guests,` add:

```rust
    stats::export_csv,
```

- [ ] **Step 3: Run — expect FAIL** (`not yet implemented`)

- [ ] **Step 4: Implement `csv_content`**

```rust
fn csv_content(
    conn: &Connection,
    kind: &str,
    from: Option<&str>,
    to: Option<&str>,
    months: Option<i64>,
) -> Result<(String, i64), AppError> {
    let yes_no = |b: bool| if b { "Ja" } else { "Nej" }.to_string();
    let mut rows: Vec<Vec<String>> = Vec::new();
    match kind {
        "loans_raw" => {
            rows.push(
                ["Utlämnad", "Återlämnad", "Vapen-ID", "Vapen", "Serienummer",
                 "Låntagare", "Gäst", "Utlämnad av", "Mottagen av"]
                    .map(String::from)
                    .to_vec(),
            );
            let mut stmt = conn.prepare(
                "SELECT c.checked_out_at, c.checked_in_at,
                        w.display_id, w.brand, w.model, w.caliber, w.serial,
                        u.name, u.is_guest, oo.name, oi.name
                 FROM checkouts c
                 JOIN users u ON u.uid = c.user_uid
                 JOIN weapons w ON w.uid = c.weapon_uid
                 LEFT JOIN users oo ON oo.uid = c.operator_out_uid
                 LEFT JOIN users oi ON oi.uid = c.operator_in_uid
                 WHERE (?1 IS NULL OR c.checked_out_at >= ?1)
                   AND (?2 IS NULL OR c.checked_out_at < ?2)
                 ORDER BY c.checked_out_at DESC, c.id DESC",
            )?;
            let data = stmt
                .query_map(rusqlite::params![from, to], |r| {
                    let out_at: String = r.get(0)?;
                    let in_at: Option<String> = r.get(1)?;
                    let brand: Option<String> = r.get(3)?;
                    let model: Option<String> = r.get(4)?;
                    let caliber: Option<String> = r.get(5)?;
                    Ok(vec![
                        fmt_local(&out_at),
                        in_at.as_deref().map(fmt_local).unwrap_or_default(),
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        weapon_name(&brand, &model, &caliber),
                        r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        r.get::<_, String>(7)?,
                        if r.get::<_, bool>(8)? { "Ja".into() } else { "Nej".into() },
                        r.get::<_, Option<String>>(9)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    ])
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows.extend(data);
        }
        "weapon_usage" => {
            rows.push(["Vapen-ID", "Vapen", "Antal lån"].map(String::from).to_vec());
            for u in weapon_usage(conn, from, to)? {
                rows.push(vec![
                    u.display_id.unwrap_or_default(),
                    weapon_name(&u.brand, &u.model, &u.caliber),
                    u.count.to_string(),
                ]);
            }
        }
        "member_activity" => {
            rows.push(["Namn", "Gäst", "Antal lån"].map(String::from).to_vec());
            for m in member_activity(conn, from, to)? {
                rows.push(vec![m.name, yes_no(m.is_guest), m.count.to_string()]);
            }
        }
        "debts" => {
            rows.push(["Namn", "Belopp (kr)"].map(String::from).to_vec());
            let mut stmt = conn.prepare(
                "SELECT u.name, SUM(d.amount_kr) AS total
                 FROM debts d JOIN users u ON u.uid = d.user_uid
                 WHERE d.settled_at IS NULL
                 GROUP BY d.user_uid
                 HAVING total > 0
                 ORDER BY total DESC",
            )?;
            let data = stmt
                .query_map([], |r| {
                    Ok(vec![r.get::<_, String>(0)?, r.get::<_, i64>(1)?.to_string()])
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows.extend(data);
        }
        "stale_assignments" => {
            rows.push(["Medlem", "Vapen-ID", "Vapen", "Senast använt"].map(String::from).to_vec());
            for s in stale_assignments(conn, months.unwrap_or(3))? {
                rows.push(vec![
                    s.name,
                    s.display_id.unwrap_or_default(),
                    weapon_name(&s.brand, &s.model, &s.caliber),
                    s.last_used.as_deref().map(fmt_local).unwrap_or_default(),
                ]);
            }
        }
        "guests" => {
            rows.push(["Namn", "Antal lån", "Senaste besök"].map(String::from).to_vec());
            for g in guest_rows(conn)? {
                rows.push(vec![
                    g.name,
                    g.loan_count.to_string(),
                    g.last_visit.as_deref().map(fmt_local).unwrap_or_default(),
                ]);
            }
        }
        other => return Err(AppError::internal(format!("unknown export kind: {other}"))),
    }
    let count = (rows.len() as i64) - 1;
    Ok((csv_join(&rows), count))
}
```

- [ ] **Step 5: Run — expect PASS** (`cargo test --manifest-path src-tauri/Cargo.toml`)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "feat(stats): CSV export command (six kinds, Swedish Excel format)"
```

---

### Task 5: Seed fixtures for new pages

**Files:**
- Modify: `src-tauri/src/seed.rs`

**Interfaces:**
- Consumes: seed's existing create fns/patterns (it calls real `create_weapon` / checkout fns — mirror surrounding code style exactly).
- Produces: dev dataset gains (a) one active never-borrowed weapon, (b) one guest with 2+ checkouts. (Tagged weapons and stale assignments already covered: `seed.rs:217-219` and `seed.rs:168-170`.)

- [ ] **Step 1: Read `src-tauri/src/seed.rs` fully.** Find where weapons are created and where guest `g1` gets its checkout (~line 213).

- [ ] **Step 2: Add fixtures, mirroring existing style**

1. Create a 21st weapon (e.g. brand `Sako`, model `Quad`, caliber `.22 LR`, next free display tag) and do **not** check it out anywhere.
2. Give `g1` a second checkout + checkin (reuse the exact call pattern of its first one, different day).

- [ ] **Step 3: Run tests + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (seed has its own smoke test; if it asserts fixed counts, update those counts).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/seed.rs
git commit -m "feat(seed): never-borrowed weapon + repeat guest fixtures for stats pages"
```

---

### Task 6: Frontend plumbing — api.ts, i18n keys, routes, nav

**Files:**
- Modify: `src/api.ts`, `src/i18n.ts`, `src/App.tsx`, `src/AppLayout.tsx`
- Create: `src/useExportCsv.ts`

**Interfaces:**
- Consumes: commands from Tasks 1–4; `save` from `@tauri-apps/plugin-dialog` (permitted via `dialog:default`); `errorMessage` from `src/errors.ts`.
- Produces: everything Tasks 7–8 import: api types/fns below, `useExportCsv()` hook, i18n keys below, routes `/stats` + `/maintenance`, NAV entries. Placeholder page components so the build stays green (real pages come in Tasks 7–8).

- [ ] **Step 1: Add to `src/api.ts`** (match existing wrapper style):

```ts
export interface StatsSummary { loanCount: number; memberCount: number; guestCount: number }
export interface LoanBucket { bucket: string; count: number }
export interface WeaponUsage {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; active: boolean; count: number;
}
export interface MemberActivity {
  userUid: number; name: string; isGuest: boolean; active: boolean; count: number;
}
export interface StaleAssignment {
  userUid: number; name: string; weaponUid: number; brand: string | null; model: string | null;
  caliber: string | null; displayId: string | null; weaponActive: boolean; lastUsed: string | null;
}
export interface NeverBorrowedWeapon {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; createdAt: string;
}
export interface TaggedWeapon {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; tagNeedsService: boolean; tagBroken: boolean;
  tagMissingParts: boolean; tagNeedsCleaning: boolean; tagComment: string | null;
}
export interface GuestRow { userUid: number; name: string; loanCount: number; lastVisit: string | null }
export type ExportKind =
  | 'loans_raw' | 'weapon_usage' | 'member_activity' | 'debts' | 'stale_assignments' | 'guests';
export type Bucket = 'hour' | 'day' | 'month' | 'year';

export const statsSummary = (from: string | null, to: string | null) =>
  invoke<StatsSummary>('stats_summary', { from, to });
export const statsLoansBuckets = (from: string | null, to: string | null, bucket: Bucket) =>
  invoke<LoanBucket[]>('stats_loans_buckets', { from, to, bucket });
export const statsWeaponUsage = (from: string | null, to: string | null) =>
  invoke<WeaponUsage[]>('stats_weapon_usage', { from, to });
export const statsMemberActivity = (from: string | null, to: string | null) =>
  invoke<MemberActivity[]>('stats_member_activity', { from, to });
export const maintenanceStaleAssignments = (months: number) =>
  invoke<StaleAssignment[]>('maintenance_stale_assignments', { months });
export const maintenanceNeverBorrowed = () =>
  invoke<NeverBorrowedWeapon[]>('maintenance_never_borrowed');
export const maintenanceTaggedWeapons = () =>
  invoke<TaggedWeapon[]>('maintenance_tagged_weapons');
export const maintenanceGuests = () => invoke<GuestRow[]>('maintenance_guests');
export const exportCsvCmd = (
  kind: ExportKind,
  path: string,
  from?: string | null,
  to?: string | null,
  months?: number | null,
) =>
  invoke<number>('export_csv', {
    kind,
    path,
    from: from ?? null,
    to: to ?? null,
    months: months ?? null,
  });
```

- [ ] **Step 2: Create `src/useExportCsv.ts`**

```ts
import { save } from '@tauri-apps/plugin-dialog';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { exportCsvCmd, type ExportKind } from './api';
import { errorMessage } from './errors';

export function useExportCsv() {
  const { t } = useTranslation();
  return async (
    kind: ExportKind,
    defaultName: string,
    params: { from?: string | null; to?: string | null; months?: number | null } = {},
  ) => {
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!path) return;
    try {
      const n = await exportCsvCmd(kind, path, params.from, params.to, params.months);
      notifications.show({ message: t('export_done', { count: n }) });
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
}
```

- [ ] **Step 3: i18n keys in `src/i18n.ts`** — add to BOTH `sv` and `en` blocks, new `// Stats & maintenance` comment section:

```ts
      // Stats & maintenance (sv)
      nav_stats: 'Statistik',
      nav_maintenance: 'Underhåll',
      stats_period_today: 'Idag',
      stats_period_week: 'Vecka',
      stats_period_month: 'Månad',
      stats_period_year: 'År',
      stats_period_all: 'Allt',
      stats_loans: 'Lån',
      stats_members: 'Medlemmar',
      stats_guests: 'Gäster',
      stats_weapon_usage: 'Vapenanvändning',
      stats_member_activity: 'Medlemsaktivitet',
      stats_active_debts: 'Aktiva skulder',
      stats_count_loans: 'Antal lån',
      stats_amount_kr: 'Belopp (kr)',
      export_csv: 'Exportera CSV',
      export_loans_raw: 'Exportera lån (CSV)',
      export_done: 'Export klar — {{count}} rader',
      maint_stale: 'Ej använda tilldelade vapen',
      maint_months: 'Månader',
      maint_last_used: 'Senast använt',
      maint_never_used: 'aldrig',
      maint_unassign: 'Ta bort tilldelning',
      maint_unassign_confirm: 'Ta bort tilldelningen av {{weapon}} från {{name}}?',
      maint_never_borrowed: 'Aldrig utlånade vapen',
      maint_registered: 'Registrerad',
      maint_tagged: 'Vapen med åtgärdsmarkering',
      maint_last_visit: 'Senaste besök',
      promote_confirm: 'Gör {{name}} till medlem?',
```

```ts
      // Stats & maintenance (en)
      nav_stats: 'Statistics',
      nav_maintenance: 'Maintenance',
      stats_period_today: 'Today',
      stats_period_week: 'Week',
      stats_period_month: 'Month',
      stats_period_year: 'Year',
      stats_period_all: 'All',
      stats_loans: 'Loans',
      stats_members: 'Members',
      stats_guests: 'Guests',
      stats_weapon_usage: 'Weapon usage',
      stats_member_activity: 'Member activity',
      stats_active_debts: 'Outstanding debts',
      stats_count_loans: 'Loans',
      stats_amount_kr: 'Amount (kr)',
      export_csv: 'Export CSV',
      export_loans_raw: 'Export loans (CSV)',
      export_done: 'Export done — {{count}} rows',
      maint_stale: 'Unused assigned weapons',
      maint_months: 'Months',
      maint_last_used: 'Last used',
      maint_never_used: 'never',
      maint_unassign: 'Remove assignment',
      maint_unassign_confirm: 'Remove the assignment of {{weapon}} from {{name}}?',
      maint_never_borrowed: 'Never borrowed weapons',
      maint_registered: 'Registered',
      maint_tagged: 'Weapons with condition tags',
      maint_last_visit: 'Last visit',
      promote_confirm: 'Promote {{name}} to member?',
```

- [ ] **Step 4: Routes + nav.** In `src/App.tsx` after the `logs` route:

```tsx
<Route path="stats" element={<StatsPage />} />
<Route path="maintenance" element={<MaintenancePage />} />
```

Create both files as placeholders so the build compiles (replaced in Tasks 7–8):

```tsx
// src/StatsPage.tsx
export function StatsPage() {
  return null;
}
```

```tsx
// src/MaintenancePage.tsx
export function MaintenancePage() {
  return null;
}
```

In `src/AppLayout.tsx` extend `NAV` (`AppLayout.tsx:22-28`):

```ts
  { to: '/stats', key: 'nav_stats' },
  { to: '/maintenance', key: 'nav_maintenance' },
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: green (tsc + vite).

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/useExportCsv.ts src/i18n.ts src/App.tsx src/AppLayout.tsx src/StatsPage.tsx src/MaintenancePage.tsx
git commit -m "feat(stats): frontend plumbing — api wrappers, i18n, routes, nav, export hook"
```

---

### Task 7: StatsPage

**Files:**
- Modify: `src/StatsPage.tsx` (replace placeholder)

**Interfaces:**
- Consumes: api fns + `useExportCsv` from Task 6; `weaponLabel`/`userLabel` from `src/labels.ts`; `fmtDate` from `src/format.ts`; existing `outstandingDebts`, `listUsers` from api.
- Produces: standalone page; nothing downstream.

- [ ] **Step 1: Implement the page**

dayjs `isoWeek` plugin ships with dayjs (no new dependency). Full component:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card, Group, ScrollArea, SegmentedControl, Stack, Table, Text, Title, ActionIcon, Button,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  statsSummary, statsLoansBuckets, statsWeaponUsage, statsMemberActivity,
  outstandingDebts, listUsers, type Bucket, type LoanBucket,
} from './api';
import { useExportCsv } from './useExportCsv';
import { weaponLabel, userLabel } from './labels';

dayjs.extend(isoWeek);

type Preset = 'today' | 'week' | 'month' | 'year' | 'all';
const LOCALE = 'sv-SE';

function periodOf(preset: Preset): { from: string | null; to: string | null; bucket: Bucket } {
  const now = dayjs();
  switch (preset) {
    case 'today':
      return { from: now.startOf('day').toISOString(), to: null, bucket: 'hour' };
    case 'week':
      return { from: now.startOf('isoWeek').toISOString(), to: null, bucket: 'day' };
    case 'month':
      return { from: now.startOf('month').toISOString(), to: null, bucket: 'day' };
    case 'year':
      return { from: now.startOf('year').toISOString(), to: null, bucket: 'month' };
    case 'all':
      return { from: null, to: null, bucket: 'year' };
  }
}

function fillBuckets(preset: Preset, rows: LoanBucket[]): { label: string; count: number }[] {
  const m = new Map(rows.map((r) => [r.bucket, r.count]));
  const now = dayjs();
  const out: { label: string; count: number }[] = [];
  if (preset === 'today') {
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0');
      out.push({ label: key, count: m.get(key) ?? 0 });
    }
  } else if (preset === 'week' || preset === 'month') {
    let d = preset === 'week' ? now.startOf('isoWeek') : now.startOf('month');
    while (d.isBefore(now, 'day') || d.isSame(now, 'day')) {
      out.push({
        label:
          preset === 'week'
            ? d.toDate().toLocaleDateString(LOCALE, { weekday: 'short' })
            : String(d.date()),
        count: m.get(d.format('YYYY-MM-DD')) ?? 0,
      });
      d = d.add(1, 'day');
    }
  } else if (preset === 'year') {
    for (let mo = 0; mo < 12; mo++) {
      const d = now.startOf('year').add(mo, 'month');
      out.push({
        label: d.toDate().toLocaleDateString(LOCALE, { month: 'short' }),
        count: m.get(d.format('YYYY-MM')) ?? 0,
      });
    }
  } else {
    const years = rows.map((r) => Number(r.bucket)).filter((y) => !Number.isNaN(y));
    const start = years.length ? Math.min(...years) : now.year();
    for (let y = start; y <= now.year(); y++) {
      out.push({ label: String(y), count: m.get(String(y)) ?? 0 });
    }
  }
  return out;
}

function Bars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 210 }}>
      {data.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            height: '100%',
            minWidth: 0,
          }}
        >
          <Text size="xs">{d.count > 0 ? d.count : ''}</Text>
          <div
            style={{
              width: '100%',
              maxWidth: 48,
              height: `${Math.round((d.count / max) * 150)}px`,
              minHeight: d.count > 0 ? 4 : 0,
              background: 'var(--mantine-color-teal-6)',
              borderRadius: '4px 4px 0 0',
            }}
          />
          <Text size="xs" c="dimmed" truncate w="100%" ta="center">
            {d.label}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>('month');
  const { from, to, bucket } = periodOf(preset);
  const doExport = useExportCsv();

  const summary = useQuery({
    queryKey: ['statsSummary', from, to],
    queryFn: () => statsSummary(from, to),
  });
  const buckets = useQuery({
    queryKey: ['statsBuckets', from, to, bucket],
    queryFn: () => statsLoansBuckets(from, to, bucket),
  });
  const usage = useQuery({
    queryKey: ['statsWeaponUsage', from, to],
    queryFn: () => statsWeaponUsage(from, to),
  });
  const activity = useQuery({
    queryKey: ['statsMemberActivity', from, to],
    queryFn: () => statsMemberActivity(from, to),
  });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const userByUid = new Map((users.data ?? []).map((u) => [u.uid, u]));
  const stamp = dayjs().format('YYYY-MM-DD');

  const tiles: [string, number | undefined][] = [
    [t('stats_loans'), summary.data?.loanCount],
    [t('stats_members'), summary.data?.memberCount],
    [t('stats_guests'), summary.data?.guestCount],
  ];

  return (
    <ScrollArea h="calc(100vh - 144px)">
      <Stack gap="lg" pb="lg">
        <Group justify="space-between">
          <SegmentedControl
            size="lg"
            value={preset}
            onChange={(v) => setPreset(v as Preset)}
            data={[
              { value: 'today', label: t('stats_period_today') },
              { value: 'week', label: t('stats_period_week') },
              { value: 'month', label: t('stats_period_month') },
              { value: 'year', label: t('stats_period_year') },
              { value: 'all', label: t('stats_period_all') },
            ]}
          />
          <Button
            leftSection={<IconDownload size={18} />}
            variant="light"
            onClick={() => doExport('loans_raw', `lan-${preset}-${stamp}.csv`, { from, to })}
          >
            {t('export_loans_raw')}
          </Button>
        </Group>

        <Group grow>
          {tiles.map(([label, value]) => (
            <Card key={label} withBorder>
              <Text c="dimmed" size="sm">{label}</Text>
              <Text fz={40} fw={700}>{value ?? '–'}</Text>
            </Card>
          ))}
        </Group>

        <Card withBorder>
          <Bars data={fillBuckets(preset, buckets.data ?? [])} />
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_weapon_usage')}</Title>
            <ActionIcon
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('weapon_usage', `vapenanvandning-${stamp}.csv`, { from, to })}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(usage.data ?? []).map((w) => (
                <Table.Tr key={w.weaponUid}>
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t)}
                  </Table.Td>
                  <Table.Td ta="right" w={100}>{w.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_member_activity')}</Title>
            <ActionIcon
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('member_activity', `medlemsaktivitet-${stamp}.csv`, { from, to })}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(activity.data ?? []).map((m) => (
                <Table.Tr key={m.userUid}>
                  <Table.Td>{userLabel(m.name, m.active, t, m.isGuest)}</Table.Td>
                  <Table.Td ta="right" w={100}>{m.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_active_debts')}</Title>
            <ActionIcon
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('debts', `skulder-${stamp}.csv`)}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(debts.data ?? []).map((d) => {
                const u = userByUid.get(d.userUid);
                return (
                  <Table.Tr key={d.userUid}>
                    <Table.Td>
                      {u ? userLabel(u.name, u.active, t, u.isGuest) : String(d.userUid)}
                    </Table.Td>
                    <Table.Td ta="right" w={140}>{d.amountKr} kr</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </ScrollArea>
  );
}
```

Adapt on the spot if tsc complains: `listUsers` return type field names (check `User` type in api.ts), `userLabel`/`weaponLabel` exact signatures (`src/labels.ts:7-26`), `outstandingDebts` row shape (`{ userUid, amountKr }`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/StatsPage.tsx
git commit -m "feat(stats): Statistik page — presets, tiles, CSS bars, tables, CSV exports"
```

---

### Task 8: MaintenancePage

**Files:**
- Modify: `src/MaintenancePage.tsx` (replace placeholder)

**Interfaces:**
- Consumes: api fns from Task 6; `setPreferredWeapon(uid, weaponUid|null)` + `promoteGuest(uid)` from api; `TagModal` (`weaponUid/opened/onClose` props); `useIsAdmin`; `weaponLabel` from labels; `fmtDate` from format.
- Produces: standalone page.

- [ ] **Step 1: Implement the page**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, Card, Group, Modal, ScrollArea, Select, Stack, Table, Text, Title, ActionIcon,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import {
  maintenanceStaleAssignments, maintenanceNeverBorrowed, maintenanceTaggedWeapons,
  maintenanceGuests, setPreferredWeapon, promoteGuest,
  type StaleAssignment, type GuestRow,
} from './api';
import { useExportCsv } from './useExportCsv';
import { useIsAdmin } from './useIsAdmin';
import { TagModal } from './TagModal';
import { weaponLabel } from './labels';
import { fmtDate } from './format';
import { errorMessage } from './errors';

export function MaintenancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const doExport = useExportCsv();
  const [months, setMonths] = useState(3);
  const [unassignTarget, setUnassignTarget] = useState<StaleAssignment | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<GuestRow | null>(null);
  const [tagWeapon, setTagWeapon] = useState<number | null>(null);

  const stale = useQuery({
    queryKey: ['maintStale', months],
    queryFn: () => maintenanceStaleAssignments(months),
  });
  const never = useQuery({ queryKey: ['maintNever'], queryFn: maintenanceNeverBorrowed });
  const tagged = useQuery({ queryKey: ['maintTagged'], queryFn: maintenanceTaggedWeapons });
  const guests = useQuery({ queryKey: ['maintGuests'], queryFn: maintenanceGuests });

  const unassignMut = useMutation({
    mutationFn: (userUid: number) => setPreferredWeapon(userUid, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintStale'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setUnassignTarget(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const promoteMut = useMutation({
    mutationFn: (uid: number) => promoteGuest(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintGuests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setPromoteTarget(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const stamp = dayjs().format('YYYY-MM-DD');

  return (
    <ScrollArea h="calc(100vh - 144px)">
      <Stack gap="lg" pb="lg">
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('maint_stale')}</Title>
            <Group>
              <Select
                w={100}
                label={t('maint_months')}
                value={String(months)}
                onChange={(v) => setMonths(v ? Number(v) : 3)}
                data={Array.from({ length: 12 }, (_, i) => String(i + 1))}
              />
              <ActionIcon
                variant="light"
                aria-label={t('export_csv')}
                onClick={() =>
                  doExport('stale_assignments', `ej-anvanda-tilldelade-${stamp}.csv`, { months })
                }
              >
                <IconDownload size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <Table>
            <Table.Tbody>
              {(stale.data ?? []).map((s) => (
                <Table.Tr key={s.userUid}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td>
                    {weaponLabel(s.brand, s.model, s.caliber, s.displayId, s.weaponActive, t)}
                  </Table.Td>
                  <Table.Td c="dimmed">
                    {t('maint_last_used')}:{' '}
                    {s.lastUsed ? fmtDate(s.lastUsed) : t('maint_never_used')}
                  </Table.Td>
                  <Table.Td w={200}>
                    <Button
                      size="sm"
                      color="orange"
                      variant="light"
                      onClick={() => setUnassignTarget(s)}
                    >
                      {t('maint_unassign')}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">{t('maint_never_borrowed')}</Title>
          <Table>
            <Table.Tbody>
              {(never.data ?? []).map((w) => (
                <Table.Tr key={w.weaponUid}>
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t)}
                  </Table.Td>
                  <Table.Td c="dimmed" w={240}>
                    {t('maint_registered')}: {fmtDate(w.createdAt)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">{t('maint_tagged')}</Title>
          <Table highlightOnHover>
            <Table.Tbody>
              {(tagged.data ?? []).map((w) => (
                <Table.Tr
                  key={w.weaponUid}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setTagWeapon(w.weaponUid)}
                >
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {w.tagNeedsService && <Badge color="yellow">{t('tag_needs_service')}</Badge>}
                      {w.tagBroken && <Badge color="red">{t('tag_broken')}</Badge>}
                      {w.tagMissingParts && <Badge color="orange">{t('tag_missing_parts')}</Badge>}
                      {w.tagNeedsCleaning && <Badge color="blue">{t('tag_needs_cleaning')}</Badge>}
                      {w.tagComment && <Text size="sm" c="dimmed">{w.tagComment}</Text>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_guests')}</Title>
            <ActionIcon
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('guests', `gaster-${stamp}.csv`)}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(guests.data ?? []).map((g) => (
                <Table.Tr key={g.userUid}>
                  <Table.Td>{g.name}</Table.Td>
                  <Table.Td w={140}>{t('stats_count_loans')}: {g.loanCount}</Table.Td>
                  <Table.Td c="dimmed" w={240}>
                    {t('maint_last_visit')}: {g.lastVisit ? fmtDate(g.lastVisit) : '–'}
                  </Table.Td>
                  <Table.Td w={180}>
                    {isAdmin && (
                      <Button size="sm" variant="light" onClick={() => setPromoteTarget(g)}>
                        {t('promote_guest')}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>

      <Modal
        opened={unassignTarget != null}
        onClose={() => setUnassignTarget(null)}
        title={t('maint_unassign')}
        centered
      >
        <Stack>
          <Text fz="lg">
            {unassignTarget &&
              t('maint_unassign_confirm', {
                weapon: weaponLabel(
                  unassignTarget.brand, unassignTarget.model, unassignTarget.caliber,
                  unassignTarget.displayId, unassignTarget.weaponActive, t,
                ),
                name: unassignTarget.name,
              })}
          </Text>
          <Text fz="lg" fw={600}>{t('are_you_sure')}</Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setUnassignTarget(null)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              color="orange"
              loading={unassignMut.isPending}
              onClick={() => unassignTarget && unassignMut.mutate(unassignTarget.userUid)}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={promoteTarget != null}
        onClose={() => setPromoteTarget(null)}
        title={t('promote_guest')}
        centered
      >
        <Stack>
          <Text fz="lg">
            {promoteTarget && t('promote_confirm', { name: promoteTarget.name })}
          </Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setPromoteTarget(null)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              loading={promoteMut.isPending}
              onClick={() => promoteTarget && promoteMut.mutate(promoteTarget.userUid)}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <TagModal
        weaponUid={tagWeapon}
        opened={tagWeapon != null}
        onClose={() => {
          setTagWeapon(null);
          qc.invalidateQueries({ queryKey: ['maintTagged'] });
        }}
      />
    </ScrollArea>
  );
}
```

Adapt on the spot if tsc complains: `setPreferredWeapon` wrapper arg shape (`api.ts:84-85`), `promoteGuest` (`api.ts:91`), tag i18n key names (grep `tag_` in `src/i18n.ts` — reuse the existing keys TagModal uses), `promote_guest` key exists already.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/MaintenancePage.tsx
git commit -m "feat(maintenance): Underhåll page — stale unassign, never-borrowed, tagged, guest promote"
```

---

### Task 9: Final gates + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

```bash
cargo test --manifest-path src-tauri/Cargo.toml && npm run build
```
Expected: both green.

- [ ] **Step 2: Seed + hand to user for live smoke** (app closed, then `npm run seed`, then `npm run tauri dev`)

User checklist:
1. Statistik: switch all five presets — tiles + bars update; bars show sane counts; Allt shows per-year bars.
2. Export raw loans + one table export → open in Excel: åäö intact, columns split on `;`.
3. Underhåll: stale list respects months select (1 vs 12); unassign → confirm popup → row disappears; assigned weapon gone in Members page too.
4. Never-borrowed shows the new seed weapon; tagged list opens TagModal on row tap and updates after save.
5. Guests sorted by loan count (repeat guest first); promote (as admin) → confirm → guest becomes member, disappears from list.
6. Both nav buttons reachable by touch; pages scroll.

- [ ] **Step 3: Merge** (after user approval)

```bash
git checkout main && git merge --no-ff feat/stats-maintenance
```
