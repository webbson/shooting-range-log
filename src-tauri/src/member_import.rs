//! Member-list import: parse the club's Svenska Lag export (xlsx) → preview →
//! commit member create/update/deactivate + admin status.
//!
//! Separate from `import.rs` (which is loans/weapons only, workstream C). This
//! module owns member lifecycle: create absent members, update matched ones
//! (name/email/phone/address/ssn/admin), and deactivate non-guest members
//! missing from the file. Guests are exempt from deactivation, but a guest
//! *matched* by SSN is promoted to a full member in the same update.
//!
//! Layout contract (verified against the real export, 172 members):
//!   Row 1: a club-name banner, not headers.
//!   Row 2: column headers — 43 columns, matched **by name**, not position
//!          (the export is expected to drift).
//!   Row 3+: one member per row.
//!
//! Same three-layer shape as `import.rs`:
//!   1. `parse_rows` — pure parsing (calamine rows in, no DB); `parse_xlsx` is
//!      a thin file-opening wrapper so tests can build rows inline instead of
//!      committing the real export (which holds 172 real personnummer).
//!   2. `build_plan` — read-only DB queries, produces `MemberImportPlan`.
//!   3. `execute`    — writes under a single transaction.
//!
//! Matching is by personnummer, compared on the last 10 digits via
//! `commands::ssn_tail10` — member SSNs are not stored canonically in the DB
//! even though the file's `Personnr.` column already is (mirrors `import.rs`
//! and the frontend scanner's `ssnDigits`). Matching considers ALL users
//! (active, inactive, and guests) so a rejoining member is reactivated rather
//! than duplicated, and a guest who turns out to be a real member is promoted
//! rather than left a walk-in forever.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::json;
use tauri::State;

use crate::commands::{ssn_tail10, user_create, user_get, user_set_active};
use crate::db::Db;
use crate::error::AppError;
use crate::import::ImportWarning;
use crate::models::{NewUser, User};

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Columns without which the import must refuse rather than guess: a missing
/// `Medlemstyp` would read every row as non-board and demote every admin; a
/// missing `Personnr.` would match nothing and deactivate everyone present.
const REQUIRED_COLS: &[&str] = &["Personnr.", "Förnamn", "Efternamn", "Medlemstyp"];

// ── Internal parse types (pure, no DB) ───────────────────────────────────────

#[derive(Debug, Clone)]
struct MemberRow {
    row: u32, // 1-based spreadsheet row, for warnings only
    name: String,
    email: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    ssn: String,     // canonical, as found in the file
    ssn_key: String, // ssn_tail10(ssn) — the match key
    is_admin: bool,  // Medlemstyp == "Styrelsemedlem"
}

#[derive(Debug)]
struct ParsedRegister {
    members: Vec<MemberRow>,
    warnings: Vec<ImportWarning>,
}

// ── Internal plan types ───────────────────────────────────────────────────────

struct UpdateDiff {
    needs_write: bool,
    admin_delta: Option<bool>, // Some(true) = promoted to admin, Some(false) = demoted
    reactivated: bool,
    promoted_from_guest: bool,
}

struct PlannedUpdate {
    uid: i64,
    row: MemberRow,
    diff: UpdateDiff,
}

struct MemberImportPlan {
    creates: Vec<MemberRow>,
    updates: Vec<PlannedUpdate>,
    /// Active, non-guest members missing from the file: (uid, name).
    deactivate: Vec<(i64, String)>,
    warnings: Vec<ImportWarning>,
}

// ── Public output types (serialised over IPC) ────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberImportPreview {
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub admin_added: Vec<String>,
    pub admin_removed: Vec<String>,
    pub deactivated: Vec<String>,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberImportResult {
    pub created: u32,
    pub updated: u32,
    pub admin_added: u32,
    pub admin_removed: u32,
    pub deactivated: u32,
    pub warnings: Vec<ImportWarning>,
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/// Extract cell value as a trimmed, non-empty string. Every relevant cell in
/// the real file is a shared string, but the numeric branches are kept as a
/// defensive fallback (string branch first).
fn cell_str(cell: &Data) -> Option<String> {
    let s = match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 { (*f as i64).to_string() } else { return None; }
        }
        Data::Int(i) => i.to_string(),
        _ => return None,
    };
    if s.is_empty() { None } else { Some(s) }
}

/// Scan the first few rows for the one containing "Personnr." — the header
/// row — rather than hardcoding an index, so a banner-row change doesn't
/// break parsing. Returns the row index and a header-name → column-index map.
fn find_header_row(rows: &[Vec<Data>]) -> Option<(usize, HashMap<String, usize>)> {
    for (i, row) in rows.iter().enumerate().take(5) {
        let mut map = HashMap::new();
        for (ci, cell) in row.iter().enumerate() {
            if let Some(s) = cell_str(cell) {
                map.insert(s, ci);
            }
        }
        if map.contains_key("Personnr.") {
            return Some((i, map));
        }
    }
    None
}

fn missing_headers_error(detail: String) -> AppError {
    AppError::new("err_member_import_headers_not_found", detail, json!({}))
}

/// Parse already-loaded rows into a `ParsedRegister`. Pure — no DB, no file
/// I/O — so tests build calamine rows inline instead of committing the real
/// export (172 real personnummer; never a test fixture).
fn parse_rows(rows: &[Vec<Data>]) -> Result<ParsedRegister, AppError> {
    let (header_idx, cols) = find_header_row(rows).ok_or_else(|| {
        missing_headers_error("Could not locate the header row (looked for 'Personnr.').".into())
    })?;

    for required in REQUIRED_COLS {
        if !cols.contains_key(*required) {
            return Err(missing_headers_error(format!(
                "Required column '{required}' not found in the header row."
            )));
        }
    }

    let pn_i = cols["Personnr."];
    let fn_i = cols["Förnamn"];
    let en_i = cols["Efternamn"];
    let mt_i = cols["Medlemstyp"];
    let ep_i = cols.get("E-post").copied();
    let mo_i = cols.get("Mobil").copied();
    let ad_i = cols.get("Adress").copied();
    let pc_i = cols.get("Postnr").copied();
    let ort_i = cols.get("Ort").copied();

    let mut members: Vec<MemberRow> = Vec::new();
    let mut warnings: Vec<ImportWarning> = Vec::new();
    let mut seen_keys: HashMap<String, u32> = HashMap::new();

    for (offset, row) in rows.iter().enumerate().skip(header_idx + 1) {
        let row_num = (offset + 1) as u32;

        let fname = row.get(fn_i).and_then(cell_str);
        let ename = row.get(en_i).and_then(cell_str);
        let pn = row.get(pn_i).and_then(cell_str);

        if fname.is_none() && ename.is_none() && pn.is_none() {
            continue; // blank row
        }

        let (Some(fname), Some(ename), Some(pn)) = (fname, ename, pn) else {
            warnings.push(ImportWarning {
                row: row_num,
                code: "warn_incomplete_row".into(),
                message: format!("Row {row_num}: missing name or personnummer — skipped"),
                name: None,
                ssn: None,
                weapon: None,
            });
            continue;
        };

        let Some(ssn_key) = ssn_tail10(&pn) else {
            warnings.push(ImportWarning {
                row: row_num,
                code: "warn_invalid_ssn".into(),
                message: format!("Row {row_num}: '{pn}' is not a usable personnummer — skipped"),
                name: Some(format!("{fname} {ename}")),
                ssn: Some(pn),
                weapon: None,
            });
            continue;
        };

        if let Some(&first_row) = seen_keys.get(&ssn_key) {
            warnings.push(ImportWarning {
                row: row_num,
                code: "warn_duplicate_member".into(),
                message: format!(
                    "Row {row_num}: duplicate personnummer (first seen row {first_row}) — skipped"
                ),
                name: Some(format!("{fname} {ename}")),
                ssn: Some(pn),
                weapon: None,
            });
            continue;
        }
        seen_keys.insert(ssn_key.clone(), row_num);

        let email = ep_i
            .and_then(|i| row.get(i))
            .and_then(cell_str)
            .and_then(|s| {
                let first = s.split(',').next().unwrap_or("").trim().to_string();
                if first.is_empty() { None } else { Some(first) }
            });
        let phone = mo_i.and_then(|i| row.get(i)).and_then(cell_str);
        let street = ad_i.and_then(|i| row.get(i)).and_then(cell_str);
        let postnr = pc_i.and_then(|i| row.get(i)).and_then(cell_str);
        let ort = ort_i.and_then(|i| row.get(i)).and_then(cell_str);
        let address = if street.is_none() && postnr.is_none() && ort.is_none() {
            None
        } else {
            let city_line = [postnr.unwrap_or_default(), ort.unwrap_or_default()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let parts: Vec<String> = [street.unwrap_or_default(), city_line]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect();
            if parts.is_empty() { None } else { Some(parts.join(", ")) }
        };

        let medlemstyp = row.get(mt_i).and_then(cell_str).unwrap_or_default();
        let is_admin = medlemstyp == "Styrelsemedlem";

        members.push(MemberRow {
            row: row_num,
            name: format!("{fname} {ename}"),
            email,
            phone,
            address,
            ssn: pn,
            ssn_key,
            is_admin,
        });
    }

    if members.is_empty() {
        return Err(missing_headers_error(
            "No data rows found under the header row.".into(),
        ));
    }

    Ok(ParsedRegister { members, warnings })
}

/// Open the workbook and parse its first (only) sheet — the real export has
/// one sheet, "Register"; there is nothing to pick.
fn parse_xlsx(path: &Path) -> Result<ParsedRegister, AppError> {
    let mut wb: Xlsx<_> = open_workbook(path)
        .map_err(|e| AppError::internal(format!("Cannot open workbook: {e}")))?;
    let sheet_name = wb
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::internal("Workbook has no sheets"))?;
    let range = wb
        .worksheet_range(&sheet_name)
        .map_err(|e| AppError::internal(format!("Cannot read sheet: {e}")))?;
    let rows: Vec<Vec<Data>> = range.rows().map(|r| r.to_vec()).collect();
    parse_rows(&rows)
}

// ── Planning (read-only DB) ───────────────────────────────────────────────────

/// What a matched row should become vs. what the DB currently holds.
/// `display_id` is not itself a reason to write — an already-active matched
/// member who still carries a legacy tag is left alone if nothing else
/// changed, so a first run doesn't read as a mass "updated" — but whenever a
/// write happens for any other reason, the UPDATE clears it unconditionally
/// (members don't use tags any more per CLAUDE.md), and reactivation always
/// counts as a reason: an inactive matched member may carry a stale tag, and
/// reactivating without clearing it first risks colliding with whoever holds
/// that tag now.
fn diff_update(row: &MemberRow, current: &User) -> UpdateDiff {
    let reactivated = !current.active;
    let promoted_from_guest = current.is_guest;
    let fields_changed = current.name != row.name
        || current.email != row.email
        || current.phone != row.phone
        || current.address != row.address
        || current.ssn.as_deref() != Some(row.ssn.as_str());
    let admin_delta = if current.is_admin != row.is_admin { Some(row.is_admin) } else { None };
    let needs_write = fields_changed || reactivated || promoted_from_guest || admin_delta.is_some();
    UpdateDiff { needs_write, admin_delta, reactivated, promoted_from_guest }
}

fn build_plan(conn: &Connection, parsed: &ParsedRegister) -> Result<MemberImportPlan, AppError> {
    // ssn_key (last 10 digits) → uid, built from ALL existing users (active,
    // inactive, and guests — a rejoining member or a walk-in-turned-member
    // must still be found). Tie-break prefers active, then non-guest, then
    // lowest uid — mirrors import.rs's build_plan and the frontend's
    // findUserBySsn.
    let ssn_map: HashMap<String, i64> = {
        let mut stmt = conn.prepare("SELECT uid, ssn, active, is_guest FROM users")?;
        let rows: Vec<(i64, Option<String>, bool, bool)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut candidates: HashMap<String, Vec<(i64, bool, bool)>> = HashMap::new();
        for (uid, ssn, active, is_guest) in rows {
            if let Some(key) = ssn.as_deref().and_then(ssn_tail10) {
                candidates.entry(key).or_default().push((uid, active, is_guest));
            }
        }
        candidates
            .into_iter()
            .map(|(key, mut cands)| {
                cands.sort_by_key(|&(uid, active, is_guest)| (!active, is_guest, uid));
                (key, cands[0].0)
            })
            .collect()
    };

    let mut creates: Vec<MemberRow> = Vec::new();
    let mut updates: Vec<PlannedUpdate> = Vec::new();
    let mut matched_uids: HashSet<i64> = HashSet::new();
    let mut warnings = parsed.warnings.clone();

    for row in &parsed.members {
        match ssn_map.get(&row.ssn_key).copied() {
            Some(uid) => {
                matched_uids.insert(uid);
                let current = user_get(conn, uid)?
                    .ok_or_else(|| AppError::internal("matched member vanished mid-import"))?;
                let diff = diff_update(row, &current);
                if diff.reactivated {
                    warnings.push(ImportWarning {
                        row: row.row,
                        code: "info_member_reactivated".into(),
                        message: format!("{}: reactivated (was inactive)", row.name),
                        name: Some(row.name.clone()),
                        ssn: Some(row.ssn.clone()),
                        weapon: None,
                    });
                }
                if diff.promoted_from_guest {
                    warnings.push(ImportWarning {
                        row: row.row,
                        code: "info_guest_promoted".into(),
                        message: format!("{}: promoted from guest to member", row.name),
                        name: Some(row.name.clone()),
                        ssn: Some(row.ssn.clone()),
                        weapon: None,
                    });
                }
                updates.push(PlannedUpdate { uid, row: row.clone(), diff });
            }
            None => creates.push(row.clone()),
        }
    }

    // Deactivation candidates: active, non-guest members not matched above —
    // but ONLY when the DB row actually has a personnummer the file could
    // have matched against. A NULL/short ssn can never appear in
    // `matched_uids` (matching is ssn-only), so without this guard such a row
    // is "unmatched" on every single run and gets deactivated every time —
    // and such rows exist by construction (the older loans import created
    // name-only members, and `user_create` accepts `ssn: None`). Skip them
    // instead and surface each as its own warning so Tom can check by hand.
    //
    // This also covers the system/operator account created by
    // `ensure_import_operator` (import.rs): "Import" is always created with
    // `ssn: None`, so it falls into this same no-usable-ssn bucket and is
    // never a deactivation candidate — no separate is_staff-keyed exemption
    // is needed to keep it *active*. It IS however still named specifically
    // below (matched exactly the way `ensure_import_operator` identifies it:
    // name = 'Import' AND is_staff = 1) purely so it's excluded from the
    // no-usable-ssn *warning* bucket too — a system account popping up in
    // "who was skipped and why" on every single run would be noise Tom has
    // to learn to ignore, defeating the point of the bucket.
    let mut stmt = conn.prepare(
        "SELECT uid, name, ssn, is_staff FROM users WHERE active = 1 AND is_guest = 0",
    )?;
    let candidates: Vec<(i64, String, Option<String>, bool)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut deactivate: Vec<(i64, String)> = Vec::new();
    for (uid, name, ssn, is_staff) in candidates {
        if matched_uids.contains(&uid) {
            continue;
        }
        let is_import_operator = is_staff && name == "Import";
        if ssn.as_deref().and_then(ssn_tail10).is_none() {
            if !is_import_operator {
                warnings.push(ImportWarning {
                    row: 0,
                    code: "warn_no_ssn_not_deactivated".into(),
                    message: format!(
                        "{name}: no usable personnummer on file — cannot be matched against the import, left active rather than auto-deactivated. Check manually."
                    ),
                    name: Some(name.clone()),
                    ssn: None,
                    weapon: None,
                });
            }
            continue;
        }
        deactivate.push((uid, name));
    }

    // A to-create row sharing a name with a to-deactivate row is the
    // signature of a stored SSN that failed to match (typo, missing dash) —
    // surface it so the operator can check before confirming rather than
    // silently retiring one row and creating a duplicate.
    let deactivate_names: HashSet<String> =
        deactivate.iter().map(|(_, n)| n.to_lowercase()).collect();
    for row in &creates {
        if deactivate_names.contains(&row.name.to_lowercase()) {
            warnings.push(ImportWarning {
                row: row.row,
                code: "warn_possible_duplicate_member".into(),
                message: format!(
                    "{}: would be created, but a member being deactivated has the same name — check for a non-matching SSN before confirming",
                    row.name
                ),
                name: Some(row.name.clone()),
                ssn: Some(row.ssn.clone()),
                weapon: None,
            });
        }
    }

    // Guardrail: the file is the source of truth for admin status. If it
    // carries zero board members, committing would demote every admin and —
    // via the bootstrap rule — turn admin gating off club-wide.
    if !parsed.members.iter().any(|m| m.is_admin) {
        warnings.push(ImportWarning {
            row: 0,
            code: "warn_no_admins_in_file".into(),
            message: "No 'Styrelsemedlem' rows in the file — every current admin would be demoted."
                .into(),
            name: None,
            ssn: None,
            weapon: None,
        });
    }

    Ok(MemberImportPlan { creates, updates, deactivate, warnings })
}

fn plan_to_preview(plan: &MemberImportPlan) -> MemberImportPreview {
    let mut created: Vec<String> = plan.creates.iter().map(|r| r.name.clone()).collect();
    let mut updated: Vec<String> = Vec::new();
    let mut admin_added: Vec<String> = Vec::new();
    let mut admin_removed: Vec<String> = Vec::new();
    for u in &plan.updates {
        if u.diff.needs_write {
            updated.push(u.row.name.clone());
        }
        match u.diff.admin_delta {
            Some(true) => admin_added.push(u.row.name.clone()),
            Some(false) => admin_removed.push(u.row.name.clone()),
            None => {}
        }
    }
    let mut deactivated: Vec<String> = plan.deactivate.iter().map(|(_, name)| name.clone()).collect();

    created.sort();
    updated.sort();
    admin_added.sort();
    admin_removed.sort();
    deactivated.sort();

    MemberImportPreview {
        created,
        updated,
        admin_added,
        admin_removed,
        deactivated,
        warnings: plan.warnings.clone(),
    }
}

// ── Execution ─────────────────────────────────────────────────────────────────

/// Execute the plan under a single transaction. Rolls back on any error.
fn execute(conn: &Connection, plan: &MemberImportPlan) -> Result<MemberImportResult, AppError> {
    let tx = conn.unchecked_transaction()?;

    // Baseline for the zero-admins guardrail below, taken before any write in
    // this transaction. A club that has no admin yet (fresh install, still in
    // the frontend's bootstrap state per CLAUDE.md) must still be able to run
    // its first import — the guard only protects an admin count that already
    // existed from being wiped out by this commit, it does not forbid
    // starting from zero.
    let admins_before: i64 =
        tx.query_row("SELECT COUNT(*) FROM users WHERE is_admin = 1 AND active = 1", [], |r| {
            r.get(0)
        })?;

    let mut created = 0u32;
    for row in &plan.creates {
        // display_id: None — new members never carry a tag (CLAUDE.md: members
        // don't use tags at all any more).
        user_create(
            &tx,
            NewUser {
                display_id: None,
                name: row.name.clone(),
                email: row.email.clone(),
                phone: row.phone.clone(),
                address: row.address.clone(),
                ssn: Some(row.ssn.clone()),
                is_staff: false,
                is_admin: row.is_admin,
                notes: None,
            },
        )?;
        created += 1;
    }

    // Targeted UPDATE rather than the full-row `user_update` — that command
    // also rewrites notes and is_staff, which the file knows nothing about.
    let mut updated = 0u32;
    let mut admin_added = 0u32;
    let mut admin_removed = 0u32;
    for u in &plan.updates {
        if !u.diff.needs_write {
            continue;
        }
        tx.execute(
            "UPDATE users SET
               name = ?2, email = ?3, phone = ?4, address = ?5, ssn = ?6,
               is_admin = ?7, active = 1, is_guest = 0, display_id = NULL, updated_at = ?8
             WHERE uid = ?1",
            params![
                u.uid,
                u.row.name,
                u.row.email,
                u.row.phone,
                u.row.address,
                u.row.ssn,
                u.row.is_admin,
                now_utc(),
            ],
        )?;
        updated += 1;
        match u.diff.admin_delta {
            Some(true) => admin_added += 1,
            Some(false) => admin_removed += 1,
            None => {}
        }
    }

    // Deactivate through the normal path so the tag is freed and the
    // preferred-weapon slot is cleared (clear_display_id = true).
    let mut deactivated = 0u32;
    for (uid, _name) in &plan.deactivate {
        user_set_active(&tx, *uid, false, true)?;
        deactivated += 1;
    }

    // Guardrail: refuse to commit a plan that would wipe out an admin count
    // that existed before this import (a filtered/renamed export demoting
    // every board row, with unmatched admins also deactivated) — checked
    // against the real post-write state on `tx`, not a pre-write simulation,
    // so it can't drift from what actually just happened. Returning before
    // commit rolls the whole transaction back (rusqlite::Transaction rolls
    // back on drop when not committed).
    if admins_before > 0 {
        let admins_after: i64 = tx.query_row(
            "SELECT COUNT(*) FROM users WHERE is_admin = 1 AND active = 1",
            [],
            |r| r.get(0),
        )?;
        if admins_after == 0 {
            return Err(AppError::new(
                "err_member_import_no_admins_remain",
                "This import would leave zero active admins — refusing to commit.",
                json!({}),
            ));
        }
    }

    tx.commit()?;

    Ok(MemberImportResult {
        created,
        updated,
        admin_added,
        admin_removed,
        deactivated,
        warnings: plan.warnings.clone(),
    })
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

fn lock<'a>(db: &'a State<'_, Db>) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock().map_err(|_| AppError::internal("db lock poisoned"))
}

/// Parse the club roster, query the DB for matches, return counts + warnings.
/// No writes.
#[tauri::command]
pub fn member_import_preview(db: State<Db>, path: String) -> Result<MemberImportPreview, AppError> {
    let parsed = parse_xlsx(Path::new(&path))?;
    let conn = lock(&db)?;
    let plan = build_plan(&conn, &parsed)?;
    Ok(plan_to_preview(&plan))
}

/// Parse, plan, and execute under one transaction. Re-parses/re-plans, same
/// idempotent pattern as `member_import_preview` and `import.rs`.
#[tauri::command]
pub fn member_import_commit(db: State<Db>, path: String) -> Result<MemberImportResult, AppError> {
    let parsed = parse_xlsx(Path::new(&path))?;
    let conn = lock(&db)?;
    let plan = build_plan(&conn, &parsed)?;
    execute(&conn, &plan)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{user_create, user_set_active, user_set_preferred_weapon, user_upsert_guest, weapon_create};
    use crate::db::migrated_in_memory;
    use crate::models::NewWeapon;

    fn cells(vals: &[&str]) -> Vec<Data> {
        vals.iter().map(|v| Data::String(v.to_string())).collect()
    }

    /// Banner + header (columns deliberately reordered & padded with unrelated
    /// columns, proving name-based matching survives drift) + data rows.
    fn sheet(data_rows: Vec<Vec<Data>>) -> Vec<Vec<Data>> {
        let mut rows = vec![
            cells(&["Landskrona Pistolklubb"]),
            cells(&[
                "Förnamn", "Efternamn", "Kön", "Personnr.", "Medlemstyp", "E-post", "Mobil",
                "Adress", "Postnr", "Ort",
            ]),
        ];
        rows.extend(data_rows);
        rows
    }

    fn member_row(
        fname: &str,
        ename: &str,
        kon: &str,
        ssn: &str,
        typ: &str,
        epost: &str,
        mobil: &str,
        adress: &str,
        postnr: &str,
        ort: &str,
    ) -> Vec<Data> {
        cells(&[fname, ename, kon, ssn, typ, epost, mobil, adress, postnr, ort])
    }

    fn mk_member_user(conn: &Connection, name: &str, ssn: &str) -> User {
        user_create(
            conn,
            NewUser {
                display_id: None,
                name: name.into(),
                ssn: Some(ssn.into()),
                is_staff: false,
                is_admin: false,
                email: None,
                phone: None,
                address: None,
                notes: None,
            },
        )
        .unwrap()
    }

    // ── parsing ──

    #[test]
    fn header_row_2_and_name_based_columns_survive_reordering() {
        let rows = sheet(vec![member_row(
            "Karl-Erik", "Provsson", "Man", "19850515-2380", "Styrelsemedlem",
            "karl@example.invalid", "070-000 00 01", "Provgatan 1", "111 11", "Teststad",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        assert_eq!(parsed.members.len(), 1);
        let m = &parsed.members[0];
        assert_eq!(m.row, 3);
        assert_eq!(m.name, "Karl-Erik Provsson");
        assert_eq!(m.ssn, "19850515-2380");
        assert_eq!(m.ssn_key, "8505152380"); // last 10 digits of the ssn above
        assert!(m.is_admin);
        assert_eq!(m.address.as_deref(), Some("Provgatan 1, 111 11 Teststad"));
    }

    #[test]
    fn comma_separated_email_takes_first_trimmed() {
        let rows = sheet(vec![member_row(
            "Anna", "Andersson", "Kvinna", "19900101-1234", "Medlem",
            "first@example.invalid, second@example.invalid", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        assert_eq!(parsed.members[0].email.as_deref(), Some("first@example.invalid"));
    }

    #[test]
    fn styrelsemedlem_sets_admin_medlem_does_not() {
        let rows = sheet(vec![
            member_row("Alice", "A", "K", "19900101-0001", "Styrelsemedlem", "", "", "", "", ""),
            member_row("Bob", "B", "M", "19900101-0002", "Medlem", "", "", "", "", ""),
        ]);
        let parsed = parse_rows(&rows).unwrap();
        assert!(parsed.members[0].is_admin);
        assert!(!parsed.members[1].is_admin);
    }

    #[test]
    fn missing_required_column_is_hard_error() {
        let rows = vec![
            cells(&["Klubben"]),
            cells(&["Förnamn", "Efternamn", "Personnr."]), // no Medlemstyp
            member_row("A", "B", "", "19900101-0001", "", "", "", "", "", ""),
        ];
        let err = parse_rows(&rows).unwrap_err();
        assert_eq!(err.code, "err_member_import_headers_not_found");
    }

    #[test]
    fn header_row_not_locatable_is_hard_error() {
        let rows = vec![cells(&["Klubben"]), cells(&["Namn", "Adress"])]; // no Personnr. anywhere
        let err = parse_rows(&rows).unwrap_err();
        assert_eq!(err.code, "err_member_import_headers_not_found");
    }

    #[test]
    fn zero_data_rows_is_hard_error() {
        let rows = sheet(vec![]);
        let err = parse_rows(&rows).unwrap_err();
        assert_eq!(err.code, "err_member_import_headers_not_found");
    }

    // ── planning + execution ──

    #[test]
    fn absent_member_is_created() {
        let conn = migrated_in_memory();
        let rows = sheet(vec![member_row(
            "New", "Member", "", "19900101-0001", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        let preview = plan_to_preview(&plan);
        assert_eq!(preview.created, vec!["New Member"]);

        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.created, 1);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn matched_member_field_and_admin_changes_are_updated() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Old Name", "19900101-0001");
        let rows = sheet(vec![member_row(
            "New", "Name", "", "19900101-0001", "Styrelsemedlem", "new@x.se", "0701234567", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        let preview = plan_to_preview(&plan);
        assert_eq!(preview.updated, vec!["New Name"]);
        assert_eq!(preview.admin_added, vec!["New Name"]);
        assert!(preview.created.is_empty());

        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.updated, 1);
        assert_eq!(result.admin_added, 1);

        let (name, email, is_admin): (String, Option<String>, bool) = conn
            .query_row(
                "SELECT name, email, is_admin FROM users WHERE ssn = '19900101-0001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "New Name");
        assert_eq!(email.as_deref(), Some("new@x.se"));
        assert!(is_admin);
    }

    #[test]
    fn admin_demoted_when_file_says_medlem() {
        let conn = migrated_in_memory();
        let nu = NewUser {
            display_id: None,
            name: "Boss".into(),
            ssn: Some("19900101-0001".into()),
            is_staff: false,
            is_admin: true,
            email: None,
            phone: None,
            address: None,
            notes: None,
        };
        user_create(&conn, nu).unwrap();
        // A second, untouched admin so this demotion doesn't trip the
        // zero-admins-remain guardrail — that guard has its own dedicated
        // tests below.
        let other_admin = NewUser {
            display_id: None,
            name: "Other Boss".into(),
            ssn: Some("19850101-1236".into()),
            is_staff: false,
            is_admin: true,
            email: None,
            phone: None,
            address: None,
            notes: None,
        };
        user_create(&conn, other_admin).unwrap();

        let rows = sheet(vec![
            member_row("Boss", "X", "", "19900101-0001", "Medlem", "", "", "", "", ""),
            member_row("Other", "Boss", "", "19850101-1236", "Styrelsemedlem", "", "", "", "", ""),
        ]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        let preview = plan_to_preview(&plan);
        assert_eq!(preview.admin_removed, vec!["Boss X"]);

        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.admin_removed, 1);
    }

    #[test]
    fn guest_matched_by_ssn_is_promoted_and_updated() {
        let conn = migrated_in_memory();
        let guest = user_upsert_guest(&conn, "Walk In".into(), "19900101-1234".into()).unwrap();
        assert!(guest.is_guest);

        let rows = sheet(vec![member_row(
            "Real", "Member", "", "19900101-1234", "Medlem", "real@x.se", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert!(plan.warnings.iter().any(|w| w.code == "info_guest_promoted"));

        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.updated, 1);
        assert_eq!(result.created, 0);

        let (is_guest, name, active): (bool, String, bool) = conn
            .query_row(
                "SELECT is_guest, name, active FROM users WHERE uid = ?1",
                params![guest.uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert!(!is_guest, "matched guest must be promoted to member");
        assert_eq!(name, "Real Member");
        assert!(active);
    }

    #[test]
    fn inactive_member_reactivated_without_colliding_on_a_reused_tag() {
        let conn = migrated_in_memory();
        // A held tag "42" while active, then went inactive keeping the tag.
        let a = user_create(
            &conn,
            NewUser {
                display_id: Some("42".into()),
                name: "Departed".into(),
                ssn: Some("19900101-0001".into()),
                is_staff: false, is_admin: false, email: None, phone: None, address: None, notes: None,
            },
        )
        .unwrap();
        user_set_active(&conn, a.uid, false, false).unwrap(); // tag retained
        // "42" is now free for active use — B takes it.
        let b = user_create(
            &conn,
            NewUser {
                display_id: Some("42".into()),
                name: "Other Holder".into(),
                ssn: Some("19900101-0002".into()),
                is_staff: false, is_admin: false, email: None, phone: None, address: None, notes: None,
            },
        )
        .unwrap();

        // Import re-matches A (same ssn), which must reactivate without
        // colliding into B's live "42". B is also in the file (still a
        // member) so only A's reactivation is under test here — B being
        // absent would legitimately deactivate B too, which is a different
        // scenario (see member_missing_from_file_is_deactivated_and_slot_cleared).
        let rows = sheet(vec![
            member_row("Departed", "Now Back", "", "19900101-0001", "Medlem", "", "", "", "", ""),
            member_row("Other", "Holder", "", "19900101-0002", "Medlem", "", "", "", "", ""),
        ]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert!(plan.warnings.iter().any(|w| w.code == "info_member_reactivated"));

        let result = execute(&conn, &plan).unwrap(); // must not error
        assert_eq!(result.updated, 1);

        let (active, display_id): (bool, Option<String>) = conn
            .query_row("SELECT active, display_id FROM users WHERE uid = ?1", params![a.uid], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!(active);
        assert_eq!(display_id, None, "tag must be cleared, members don't use tags");

        let b_tag: Option<String> = conn
            .query_row("SELECT display_id FROM users WHERE uid = ?1", params![b.uid], |r| r.get(0))
            .unwrap();
        assert_eq!(b_tag.as_deref(), Some("42"), "B's live tag must be untouched");
    }

    #[test]
    fn member_missing_from_file_is_deactivated_and_slot_cleared() {
        let conn = migrated_in_memory();
        let m = mk_member_user(&conn, "Leaving", "19900101-0001");
        let w = weapon_create(
            &conn,
            NewWeapon { display_id: Some("7".into()), brand: None, model: None, serial: None, caliber: None, notes: None },
        )
        .unwrap();
        user_set_preferred_weapon(&conn, m.uid, Some(w.uid)).unwrap();

        let rows = sheet(vec![member_row(
            "Someone", "Else", "", "19900101-9999", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert_eq!(plan.deactivate.len(), 1);
        assert_eq!(plan.deactivate[0].1, "Leaving");

        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.deactivated, 1);

        let (active, pref): (bool, Option<i64>) = conn
            .query_row(
                "SELECT active, preferred_weapon_uid FROM users WHERE uid = ?1",
                params![m.uid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(!active);
        assert_eq!(pref, None, "deactivation must free the preferred-weapon slot");
    }

    #[test]
    fn guest_not_in_file_is_exempt_from_deactivation() {
        let conn = migrated_in_memory();
        let guest = user_upsert_guest(&conn, "Casual Guest".into(), "19900101-1234".into()).unwrap();

        let rows = sheet(vec![member_row(
            "Someone", "Else", "", "19900101-9999", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert!(plan.deactivate.iter().all(|(uid, _)| *uid != guest.uid));

        execute(&conn, &plan).unwrap();
        let active: bool = conn
            .query_row("SELECT active FROM users WHERE uid = ?1", params![guest.uid], |r| r.get(0))
            .unwrap();
        assert!(active, "guest must never be deactivated by this import");
    }

    #[test]
    fn staff_account_without_ssn_is_exempt_from_deactivation() {
        let conn = migrated_in_memory();
        let sys = user_create(
            &conn,
            NewUser {
                display_id: None,
                name: "Import".into(),
                ssn: None,
                is_staff: true,
                is_admin: false,
                email: None,
                phone: None,
                address: None,
                notes: None,
            },
        )
        .unwrap();

        let rows = sheet(vec![member_row(
            "Someone", "Else", "", "19900101-9999", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert!(plan.deactivate.iter().all(|(uid, _)| *uid != sys.uid));
        // The system account has no ssn either, so defect 1's fix alone
        // would put it in the no-ssn warning bucket on every run — it's
        // named specifically to keep that bucket free of system noise.
        assert!(
            !plan.warnings.iter().any(|w| w.code == "warn_no_ssn_not_deactivated"),
            "the Import system account must not show up in the no-ssn warning bucket"
        );
    }

    #[test]
    fn commit_allowed_when_no_admin_existed_before() {
        // A club with no admin yet (fresh install / still in the frontend's
        // bootstrap gate-disabled state) must still be able to run its first
        // import even if the file also carries no Styrelsemedlem row — the
        // zero-admins guardrail only protects an admin count that already
        // existed, it does not forbid starting from zero.
        let conn = migrated_in_memory();
        let rows = sheet(vec![member_row(
            "New", "Member", "", "19900101-0001", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        let result = execute(&conn, &plan).unwrap();
        assert_eq!(result.created, 1);
        assert!(!crate::commands::admin_exists(&conn).unwrap());
    }

    #[test]
    fn idempotent_second_run_writes_nothing() {
        let conn = migrated_in_memory();
        let rows = sheet(vec![member_row(
            "Same", "Person", "", "19900101-0001", "Styrelsemedlem", "a@x.se", "070", "Gata 1", "123 45", "Ort",
        )]);
        let parsed = parse_rows(&rows).unwrap();

        let plan1 = build_plan(&conn, &parsed).unwrap();
        let r1 = execute(&conn, &plan1).unwrap();
        assert_eq!(r1.created, 1);

        let plan2 = build_plan(&conn, &parsed).unwrap();
        let r2 = execute(&conn, &plan2).unwrap();
        assert_eq!(r2.created, 0);
        assert_eq!(r2.updated, 0);
        assert_eq!(r2.admin_added, 0);
        assert_eq!(r2.admin_removed, 0);
        assert_eq!(r2.deactivated, 0);
    }

    #[test]
    fn member_with_no_ssn_is_never_deactivated_and_is_warned_about() {
        let conn = migrated_in_memory();
        // Mirrors a name-only member created by the older loans import.
        let m = user_create(
            &conn,
            NewUser {
                display_id: None,
                name: "No Ssn".into(),
                ssn: None,
                is_staff: false,
                is_admin: false,
                email: None,
                phone: None,
                address: None,
                notes: None,
            },
        )
        .unwrap();

        let rows = sheet(vec![member_row(
            "Someone", "Else", "", "19850101-1236", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();

        assert!(
            plan.deactivate.iter().all(|(uid, _)| *uid != m.uid),
            "a member with no usable ssn must never be an auto-deactivation candidate"
        );
        assert!(plan.warnings.iter().any(|w| w.code == "warn_no_ssn_not_deactivated"));

        // Run twice — confirms it is not deactivated "eventually" either.
        execute(&conn, &plan).unwrap();
        let plan2 = build_plan(&conn, &parsed).unwrap();
        let result2 = execute(&conn, &plan2).unwrap();
        assert_eq!(result2.deactivated, 0);
        let active: bool = conn
            .query_row("SELECT active FROM users WHERE uid = ?1", params![m.uid], |r| r.get(0))
            .unwrap();
        assert!(active, "must stay active across repeated runs");
    }

    #[test]
    fn commit_refuses_when_it_would_leave_zero_active_admins() {
        let conn = migrated_in_memory();
        let admin = NewUser {
            display_id: None,
            name: "Sole Admin".into(),
            ssn: Some("19850101-1236".into()),
            is_staff: false,
            is_admin: true,
            email: None,
            phone: None,
            address: None,
            notes: None,
        };
        user_create(&conn, admin).unwrap();
        assert!(crate::commands::admin_exists(&conn).unwrap());

        // File demotes the only admin and carries no Styrelsemedlem rows.
        let rows = sheet(vec![member_row(
            "Sole", "Admin", "", "19850101-1236", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert_eq!(plan.warnings.iter().filter(|w| w.code == "warn_no_admins_in_file").count(), 1);

        let err = execute(&conn, &plan).unwrap_err();
        assert_eq!(err.code, "err_member_import_no_admins_remain");

        // Rolled back: still an admin, still the old field values.
        assert!(crate::commands::admin_exists(&conn).unwrap());
        let (name, is_admin): (String, bool) = conn
            .query_row(
                "SELECT name, is_admin FROM users WHERE ssn = '19850101-1236'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Sole Admin", "update must have rolled back too");
        assert!(is_admin);
    }

    #[test]
    fn commit_succeeds_when_a_new_admin_replaces_the_old_one() {
        let conn = migrated_in_memory();
        let old_admin = NewUser {
            display_id: None,
            name: "Old Admin".into(),
            ssn: Some("19850101-1236".into()),
            is_staff: false,
            is_admin: true,
            email: None,
            phone: None,
            address: None,
            notes: None,
        };
        user_create(&conn, old_admin).unwrap();

        // Old admin demoted, but a different row is promoted — never zero.
        let rows = sheet(vec![
            member_row("Old", "Admin", "", "19850101-1236", "Medlem", "", "", "", "", ""),
            member_row("New", "Admin", "", "19900101-4563", "Styrelsemedlem", "", "", "", "", ""),
        ]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();

        let result = execute(&conn, &plan).unwrap();
        // "New Admin" is a create, not an update — admin_added only counts
        // matched rows flipping to admin (see plan_to_preview/execute), so
        // the new admin doesn't show up in that counter even though they
        // keep the active-admin count above zero.
        assert_eq!(result.admin_added, 0);
        assert_eq!(result.admin_removed, 1);
        assert!(crate::commands::admin_exists(&conn).unwrap());
    }

    #[test]
    fn no_board_members_in_file_warns() {
        let conn = migrated_in_memory();
        let rows = sheet(vec![member_row(
            "Only", "Member", "", "19900101-0001", "Medlem", "", "", "", "", "",
        )]);
        let parsed = parse_rows(&rows).unwrap();
        let plan = build_plan(&conn, &parsed).unwrap();
        assert!(plan.warnings.iter().any(|w| w.code == "warn_no_admins_in_file"));
    }
}
