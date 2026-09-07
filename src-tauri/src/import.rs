//! Excel import: parse xlsx → preview → commit historical weapon/loan data.
//!
//! Loans/weapons only — this sync never creates, updates, or deactivates a
//! member (that is workstream D's job, via a separate member-list import).
//! Rows are matched to existing members by personnummer only, compared on the
//! last 10 digits via `commands::ssn_tail10` (member SSNs are not stored
//! canonically — `user_create` trims, `user_upsert_guest` canonicalises).  A
//! row that matches no member is skipped, never created, and reported as a
//! `warn_member_unmatched` warning carrying enough to identify the person.
//!
//! Three-layer architecture (each testable in isolation):
//!   1. `parse_xlsx` — pure file parsing, no DB.
//!   2. `build_plan` — read-only DB queries, produces `ImportPlan`.
//!   3. `execute`    — writes under a single transaction, returns `ImportResult`.
//!
//! Tauri command wrappers re-parse and re-plan on each call so preview and
//! commit are both idempotent given the same file.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::commands::{
    ssn_tail10, user_create, user_set_preferred_weapon, weapon_create,
};
use crate::db::Db;
use crate::error::AppError;
use crate::models::{NewUser, NewWeapon};
use crate::stats::csv_join;

// ── Public output types (serialised over IPC) ────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    pub row: u32,
    pub code: String,
    pub message: String,
    /// Structured identification fields — populated only for
    /// `warn_member_unmatched`, so the UI can render a translated row
    /// (name/ssn/weapon) instead of the freeform `message` every other
    /// warning code uses.
    pub name: Option<String>,
    pub ssn: Option<String>,
    pub weapon: Option<String>, // ", "-joined weapon numbers referenced by the row
}

impl ImportWarning {
    fn simple(row: u32, code: &str, message: String) -> Self {
        ImportWarning { row, code: code.into(), message, name: None, ssn: None, weapon: None }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// Rows that matched no member — skipped, never created. See warnings
    /// (code `warn_member_unmatched`) for who, and `import_export_unmatched`
    /// to export the list.
    pub members_unmatched: u32,
    pub members_to_match: u32,
    pub weapons_to_create: u32,
    pub weapons_existing: u32,
    pub loans_to_create: u32,
    pub loans_skipped_duplicate: u32,
    /// New loans that would be left open (no check-in date) after import.
    pub open_loans: u32,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub members_unmatched: u32,
    pub members_matched: u32,
    pub weapons_created: u32,
    pub weapons_matched: u32,
    pub loans_created: u32,
    pub loans_skipped: u32,
    /// Number of open loans that were closed by the mark-returned option.
    pub open_loans_marked_returned: u32,
    pub warnings: Vec<ImportWarning>,
}

// ── Internal parse types (pure, no DB) ───────────────────────────────────────

#[derive(Debug)]
pub struct ParsedLoan {
    pub weapon_no: String,
    pub checked_out_at: String, // RFC3339 UTC at noon
    pub checked_in_at: Option<String>,
}

#[derive(Debug)]
pub struct ParsedMember {
    pub row: u32, // 1-based spreadsheet row (the member's "ID")
    pub name: String,
    pub ssn: Option<String>,     // raw, as typed in the file (trimmed) — for display/export
    pub ssn_key: Option<String>, // ssn_tail10(ssn) — the match key
    pub favorite_weapon_no: Option<String>, // col 2 (`vapen`) — numeric tag or None
    pub loans: Vec<ParsedLoan>,
}

#[derive(Debug)]
pub struct ParsedSheet {
    pub members: Vec<ParsedMember>,
    pub warnings: Vec<ImportWarning>,
}

// ── Internal plan types ───────────────────────────────────────────────────────

struct WeaponAction {
    display_id: String, // the numeric weapon tag
    existing_uid: Option<i64>,
}

struct LoanAction {
    member_row: u32,
    weapon_no: String,
    checked_out_at: String,
    checked_in_at: Option<String>,
    skip: bool, // true = already in DB (dedup)
}

struct ImportPlan {
    /// Matched members only: sheet row → existing user uid.
    row_to_uid: HashMap<u32, i64>,
    /// Matched members' favorite-weapon rows: (sheet row, weapon number).
    favorites: Vec<(u32, String)>,
    weapons: Vec<WeaponAction>,
    loans: Vec<LoanAction>,
    warnings: Vec<ImportWarning>,
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/// Convert an Excel date serial (days since 1899-12-30) to an RFC3339 UTC string
/// at noon, avoiding day-shift across European timezones.
fn excel_serial_to_rfc3339(serial: f64) -> Option<String> {
    let days = serial as u64;
    let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
    let date = base.checked_add_days(chrono::Days::new(days))?;
    let dt = date.and_hms_opt(12, 0, 0)?.and_utc();
    Some(dt.to_rfc3339())
}

/// Extract cell value as a trimmed, non-empty string.
fn cell_as_str(cell: &Data) -> Option<String> {
    let s = match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            // Round-trip whole numbers cleanly (e.g. 36.0 → "36")
            if f.fract() == 0.0 && f.abs() < 1e15 {
                (*f as i64).to_string()
            } else {
                return None;
            }
        }
        Data::Int(i) => i.to_string(),
        _ => return None,
    };
    if s.is_empty() { None } else { Some(s) }
}

/// Extract cell value as f64 (for date serials).
fn cell_as_f64(cell: &Data) -> Option<f64> {
    match cell {
        Data::Float(f) => Some(*f),
        Data::Int(i) => Some(*i as f64),
        // calamine 0.26: date-formatted cells come as ExcelDateTime; as_f64() returns the serial.
        Data::DateTime(dt) => Some(dt.as_f64()),
        _ => None,
    }
}

/// True iff string is a non-empty all-ASCII-digit token (a valid weapon number).
fn is_weapon_no(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// Normalize member name to title case (first letter of each word uppercased,
/// rest lowercased). Handles Swedish Å/Ä/Ö via Unicode char methods.
fn normalize_name(s: &str) -> String {
    s.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse the `utlåning`-style sheet into a `ParsedSheet`.
///
/// Layout contract (verified against the real file):
///   Row 1 (index 0): Excel date serials above each `utlev` column.
///   Row 2 (index 1): blank spacer.
///   Row 3 (index 2): labels — col0=Navn, col1=Person nummer, col2=vapen,
///                    col3=flag, then alternating `utlev`/`inlev` pairs.
///   Row 4+ (index 3+): one member per row.
pub fn parse_xlsx(path: &Path, sheet_name: &str) -> Result<ParsedSheet, AppError> {
    let mut wb: Xlsx<_> = open_workbook(path)
        .map_err(|e| AppError::internal(format!("Cannot open workbook: {e}")))?;

    let range = wb
        .worksheet_range(sheet_name)
        .map_err(|_| AppError::new(
            "err_import_sheet_not_found",
            format!("Sheet '{sheet_name}' not found"),
            serde_json::json!({ "sheet": sheet_name }),
        ))?;

    let mut warnings: Vec<ImportWarning> = Vec::new();

    let all_rows: Vec<&[Data]> = range.rows().collect();

    if all_rows.len() < 4 {
        return Ok(ParsedSheet { members: Vec::new(), warnings });
    }

    let date_row = all_rows[0]; // row 1: date serials
    let header_row = all_rows[2]; // row 3: column labels

    // Locate utlev/Inlev column pairs by scanning header row.
    // Each pair: (utlev_col_idx, inlev_col_idx, Optional<date_rfc3339>)
    let mut utlev_cols: Vec<(usize, Option<String>)> = Vec::new();
    let mut inlev_cols: Vec<usize> = Vec::new();

    for (i, cell) in header_row.iter().enumerate() {
        if let Some(label) = cell_as_str(cell) {
            let lower = label.to_lowercase();
            if lower == "utlev" {
                let date = date_row
                    .get(i)
                    .and_then(|c| cell_as_f64(c))
                    .and_then(excel_serial_to_rfc3339);
                utlev_cols.push((i, date));
            } else if lower == "inlev" {
                inlev_cols.push(i);
            }
        }
    }

    // Pair up utlev/Inlev columns (the sheet always has equal counts).
    let pairs: Vec<(usize, usize, Option<String>)> = utlev_cols
        .iter()
        .zip(inlev_cols.iter())
        .map(|((u, d), i)| (*u, *i, d.clone()))
        .collect();

    // Dedup maps (within-file): ssn_key → member index, normalised name → member index.
    let mut ssn_to_idx: HashMap<String, usize> = HashMap::new();
    let mut name_to_idx: HashMap<String, usize> = HashMap::new();
    let mut members: Vec<ParsedMember> = Vec::new();

    for (row_offset, row) in all_rows.iter().enumerate().skip(3) {
        let row_num = (row_offset + 1) as u32; // 1-based spreadsheet row

        let name = match row.get(0).and_then(|c| cell_as_str(c)) {
            Some(n) if !n.is_empty() => normalize_name(&n),
            _ => continue, // blank row
        };

        let ssn = row.get(1).and_then(|c| cell_as_str(c));
        let ssn_key = ssn.as_deref().and_then(ssn_tail10);

        // Col 2: favorite weapon number (numeric tag only).
        let favorite_weapon_no = match row.get(2).and_then(|c| cell_as_str(c)) {
            None => None,
            Some(v) if is_weapon_no(&v) => Some(v),
            Some(v) => {
                warnings.push(ImportWarning::simple(
                    row_num,
                    "warn_junk_cell",
                    format!("Row {row_num}: non-numeric value '{v}' in vapen column ignored"),
                ));
                None
            }
        };

        // Parse loan entries for this row.
        let mut loans: Vec<ParsedLoan> = Vec::new();
        for (utlev_col, inlev_col, date_opt) in &pairs {
            let utlev_val = row.get(*utlev_col).and_then(|c| cell_as_str(c));
            let inlev_val = row.get(*inlev_col).and_then(|c| cell_as_str(c));

            match &utlev_val {
                None => {
                    if inlev_val.is_some() {
                        warnings.push(ImportWarning::simple(
                            row_num,
                            "warn_orphan_checkin",
                            format!(
                                "Row {row_num}: check-in without checkout at col {} — skipped",
                                utlev_col + 1
                            ),
                        ));
                    }
                }
                Some(v) if !is_weapon_no(v) => {
                    warnings.push(ImportWarning::simple(
                        row_num,
                        "warn_junk_cell",
                        format!("Row {row_num}: non-numeric value '{v}' ignored"),
                    ));
                }
                Some(weapon_no) => match date_opt {
                    None => {
                        warnings.push(ImportWarning::simple(
                            row_num,
                            "warn_no_date",
                            format!(
                                "Row {row_num}: weapon {weapon_no} in undated column — skipped"
                            ),
                        ));
                    }
                    Some(date) => {
                        let returned =
                            inlev_val.as_deref().map(is_weapon_no).unwrap_or(false);
                        loans.push(ParsedLoan {
                            weapon_no: weapon_no.clone(),
                            checked_out_at: date.clone(),
                            checked_in_at: if returned { Some(date.clone()) } else { None },
                        });
                    }
                },
            }
        }

        // Deduplicate within file: merge duplicate rows (same ssn_key, or same
        // name when no SSN) into the first occurrence.
        let norm_name = name.to_lowercase();
        let merge_into: Option<usize> = ssn_key
            .as_ref()
            .and_then(|s| ssn_to_idx.get(s.as_str()).copied())
            .or_else(|| name_to_idx.get(&norm_name).copied());

        if let Some(idx) = merge_into {
            members[idx].loans.extend(loans);
            // Keep the first non-empty favorite across duplicate rows.
            if members[idx].favorite_weapon_no.is_none() {
                members[idx].favorite_weapon_no = favorite_weapon_no;
            }
            warnings.push(ImportWarning::simple(
                row_num,
                "warn_duplicate_member",
                format!(
                    "Row {row_num}: '{name}' merged with earlier row (duplicate in file)"
                ),
            ));
        } else {
            let idx = members.len();
            if let Some(ref s) = ssn_key {
                ssn_to_idx.insert(s.clone(), idx);
            }
            name_to_idx.insert(norm_name, idx);
            members.push(ParsedMember { row: row_num, name, ssn, ssn_key, favorite_weapon_no, loans });
        }
    }

    let name_only = members.iter().filter(|m| m.ssn_key.is_none()).count();
    if name_only > 0 {
        warnings.push(ImportWarning::simple(
            0,
            "info_name_only_members",
            format!(
                "{name_only} member(s) have no personnummer and cannot be matched — skipped"
            ),
        ));
    }

    Ok(ParsedSheet { members, warnings })
}

// ── Planning (read-only DB) ───────────────────────────────────────────────────

fn build_plan(conn: &Connection, parsed: &ParsedSheet) -> Result<ImportPlan, AppError> {
    // ssn_key (last 10 digits) → uid, built from ALL existing users (active +
    // inactive — same durable identity). A tail-10 key can hit more than one
    // user (e.g. an active member and an active guest holding the same SSN in
    // different stored formats); tie-break prefers active, then non-guest,
    // then lowest uid — mirrors the frontend's `findUserBySsn`.
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

    // Active weapon display_id → uid.
    let weapon_map: HashMap<String, i64> = {
        let mut stmt = conn.prepare(
            "SELECT uid, display_id FROM weapons WHERE active = 1 AND display_id IS NOT NULL",
        )?;
        let pairs: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(0)?)))?
            .filter_map(|r| r.ok())
            .collect();
        pairs.into_iter().collect()
    };

    // Existing loans as a set of (user_uid, weapon_uid, date-prefix) for dedup.
    let existing_loans: HashSet<(i64, i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT user_uid, weapon_uid, checked_out_at FROM checkouts",
        )?;
        let rows: Vec<(i64, i64, String)> = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows.into_iter()
            .map(|(u, w, d)| (u, w, d[..10.min(d.len())].to_string()))
            .collect()
    };

    let mut row_to_uid: HashMap<u32, i64> = HashMap::new();
    let mut warnings = parsed.warnings.clone();

    for pm in &parsed.members {
        match pm.ssn_key.as_ref().and_then(|k| ssn_map.get(k)).copied() {
            Some(uid) => {
                row_to_uid.insert(pm.row, uid);
            }
            None => {
                let mut weapon_nos: Vec<String> = pm
                    .loans
                    .iter()
                    .map(|l| l.weapon_no.clone())
                    .chain(pm.favorite_weapon_no.clone())
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect();
                weapon_nos.sort();
                let weapon_field = weapon_nos.join(", ");
                warnings.push(ImportWarning {
                    row: pm.row,
                    code: "warn_member_unmatched".into(),
                    message: format!(
                        "Row {}: {} ({}) matches no member — weapon(s) {} — skipped",
                        pm.row,
                        pm.name,
                        pm.ssn.as_deref().unwrap_or("no ssn"),
                        if weapon_field.is_empty() { "none".into() } else { weapon_field.clone() },
                    ),
                    name: Some(pm.name.clone()),
                    ssn: pm.ssn.clone(),
                    weapon: Some(weapon_field),
                });
            }
        }
    }

    // Collect weapon numbers referenced by MATCHED members only (loans +
    // favorites) — an unmatched row's weapons must never be created, since
    // its loan is never inserted (would otherwise orphan weapon rows).
    let all_weapon_nos: HashSet<String> = parsed
        .members
        .iter()
        .filter(|pm| row_to_uid.contains_key(&pm.row))
        .flat_map(|m| m.loans.iter().map(|l| l.weapon_no.clone()).chain(m.favorite_weapon_no.clone()))
        .collect();

    let mut weapon_actions: Vec<WeaponAction> = Vec::new();
    let mut weapon_no_to_existing_uid: HashMap<String, Option<i64>> = HashMap::new();

    for wno in &all_weapon_nos {
        let existing = weapon_map.get(wno).copied();
        weapon_no_to_existing_uid.insert(wno.clone(), existing);
        weapon_actions.push(WeaponAction {
            display_id: wno.clone(),
            existing_uid: existing,
        });
    }

    // Build loan + favorite actions — matched members only.
    let mut loan_actions: Vec<LoanAction> = Vec::new();
    let mut favorites: Vec<(u32, String)> = Vec::new();

    for pm in &parsed.members {
        let user_uid = match row_to_uid.get(&pm.row) {
            Some(&u) => u,
            None => continue,
        };

        if let Some(no) = &pm.favorite_weapon_no {
            favorites.push((pm.row, no.clone()));
        }

        for loan in &pm.loans {
            let weapon_uid_opt = weapon_no_to_existing_uid
                .get(&loan.weapon_no)
                .copied()
                .flatten();

            let date_key = loan.checked_out_at[..10.min(loan.checked_out_at.len())].to_string();
            let skip = match weapon_uid_opt {
                Some(weapon_uid) => existing_loans.contains(&(user_uid, weapon_uid, date_key)),
                None => false,
            };

            loan_actions.push(LoanAction {
                member_row: pm.row,
                weapon_no: loan.weapon_no.clone(),
                checked_out_at: loan.checked_out_at.clone(),
                checked_in_at: loan.checked_in_at.clone(),
                skip,
            });
        }
    }

    Ok(ImportPlan {
        row_to_uid,
        favorites,
        weapons: weapon_actions,
        loans: loan_actions,
        warnings,
    })
}

fn plan_to_preview(plan: &ImportPlan) -> ImportPreview {
    ImportPreview {
        members_unmatched: plan.warnings.iter().filter(|w| w.code == "warn_member_unmatched").count() as u32,
        members_to_match: plan.row_to_uid.len() as u32,
        weapons_to_create: plan.weapons.iter().filter(|w| w.existing_uid.is_none()).count() as u32,
        weapons_existing: plan.weapons.iter().filter(|w| w.existing_uid.is_some()).count() as u32,
        loans_to_create: plan.loans.iter().filter(|l| !l.skip).count() as u32,
        loans_skipped_duplicate: plan.loans.iter().filter(|l| l.skip).count() as u32,
        open_loans: plan
            .loans
            .iter()
            .filter(|l| !l.skip && l.checked_in_at.is_none())
            .count() as u32,
        warnings: plan.warnings.clone(),
    }
}

/// Build the "unmatched rows" CSV — `;`-separated, UTF-8 BOM, Swedish headers,
/// matching the conventions in `stats::csv_content`. Returns (content, count).
fn unmatched_csv(plan: &ImportPlan) -> (String, i64) {
    let mut rows: Vec<Vec<String>> =
        vec![["Rad", "Namn", "Personnummer", "Vapen-ID"].map(String::from).to_vec()];
    for w in plan.warnings.iter().filter(|w| w.code == "warn_member_unmatched") {
        rows.push(vec![
            w.row.to_string(),
            w.name.clone().unwrap_or_default(),
            w.ssn.clone().unwrap_or_default(),
            w.weapon.clone().unwrap_or_default(),
        ]);
    }
    let count = (rows.len() as i64) - 1;
    (csv_join(&rows), count)
}

// ── Execution ─────────────────────────────────────────────────────────────────

/// Find or create the "Import" staff user used as the operator on all imported loans.
fn ensure_import_operator(conn: &Connection) -> Result<i64, AppError> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT uid FROM users WHERE name = 'Import' AND is_staff = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;

    if let Some(uid) = existing {
        return Ok(uid);
    }

    let user = user_create(
        conn,
        NewUser {
            display_id: None,
            name: "Import".into(),
            email: None,
            phone: None,
            address: None,
            ssn: None,
            is_staff: true,
            is_admin: false,
            notes: Some("Systemkonto för importerade historiska data.".into()),
        },
    )?;
    Ok(user.uid)
}

/// Execute the plan under a single transaction. Rolls back on any error.
///
/// If `mark_open_as_returned` is true, newly inserted loans with no check-in
/// date are closed on the same day (checked_in_at = checked_out_at).
fn execute(
    conn: &Connection,
    plan: &ImportPlan,
    mark_open_as_returned: bool,
) -> Result<ImportResult, AppError> {
    let tx = conn.unchecked_transaction()?;

    // Ensure the Import operator exists *within* the transaction so that if
    // anything fails the operator record is also rolled back.
    let import_uid = ensure_import_operator(&tx)?;

    let mut wno_to_uid: HashMap<String, i64> = HashMap::new();
    let mut weapons_created = 0u32;
    let mut weapons_matched = 0u32;
    let mut loans_created = 0u32;
    let mut loans_skipped = 0u32;
    let mut open_loans_marked_returned = 0u32;

    // Create/match weapons (weapons require a display_id — all weapon_nos are numeric tags).
    for w in &plan.weapons {
        if let Some(uid) = w.existing_uid {
            wno_to_uid.insert(w.display_id.clone(), uid);
            weapons_matched += 1;
        } else {
            let weapon = weapon_create(
                &tx,
                NewWeapon {
                    display_id: Some(w.display_id.clone()),
                    brand: None,
                    model: None,
                    serial: None,
                    caliber: None,
                    notes: Some("Importerat från Excel.".into()),
                },
            )?;
            wno_to_uid.insert(w.display_id.clone(), weapon.uid);
            weapons_created += 1;
        }
    }

    // Insert loan rows directly into checkouts (bypassing do_checkout which
    // hard-codes now() and rejects "already out").  Append-only: never deletes.
    for loan in &plan.loans {
        if loan.skip {
            loans_skipped += 1;
            continue;
        }
        let user_uid = match plan.row_to_uid.get(&loan.member_row) {
            Some(&u) => u,
            None => continue, // unmatched — never reached, build_plan excludes these
        };
        let weapon_uid = match wno_to_uid.get(&loan.weapon_no) {
            Some(&w) => w,
            None => continue,
        };

        // Determine effective check-in: use the spreadsheet value, or if the
        // operator chose "mark all open as returned", close it on the same day.
        let effective_checked_in_at = match &loan.checked_in_at {
            Some(d) => Some(d.clone()),
            None if mark_open_as_returned => {
                open_loans_marked_returned += 1;
                Some(loan.checked_out_at.clone())
            }
            None => None,
        };

        tx.execute(
            "INSERT INTO checkouts
               (weapon_uid, user_uid, operator_out_uid, checked_out_at,
                operator_in_uid, checked_in_at, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Importerat')",
            params![
                weapon_uid,
                user_uid,
                import_uid,
                loan.checked_out_at,
                if effective_checked_in_at.is_some() { Some(import_uid) } else { None::<i64> },
                effective_checked_in_at,
            ],
        )?;
        loans_created += 1;
    }

    // Set favorite weapons for matched members — after members and weapons
    // are guaranteed to exist. Never overwrites a pre-existing preference
    // (skip silently). First row wins within-file: on conflict, warn and continue.
    let mut warnings = plan.warnings.clone();
    for (row, no) in &plan.favorites {
        let user_uid = match plan.row_to_uid.get(row) {
            Some(&u) => u,
            None => continue,
        };
        let weapon_uid = match wno_to_uid.get(no.as_str()) {
            Some(&w) => w,
            None => continue,
        };
        // Skip if the matched member is inactive — setting a favorite on a
        // deactivated member would occupy the exclusive slot and block active members.
        let active: bool = tx
            .query_row(
                "SELECT active FROM users WHERE uid = ?1",
                params![user_uid],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(false);
        if !active {
            warnings.push(ImportWarning::simple(
                *row,
                "warn_favorite_inactive_member",
                format!("Row {row}: member is inactive — favorite weapon {no} skipped"),
            ));
            continue;
        }
        // Skip if the member already has a live preference (never overwrite).
        let existing_pref: Option<i64> = tx
            .query_row(
                "SELECT preferred_weapon_uid FROM users WHERE uid = ?1",
                params![user_uid],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        if existing_pref.is_some() {
            continue;
        }
        match user_set_preferred_weapon(&tx, user_uid, Some(weapon_uid)) {
            Ok(_) => {}
            Err(e) if e.code == "err_weapon_already_preferred" => {
                warnings.push(ImportWarning::simple(
                    *row,
                    "warn_favorite_conflict",
                    format!(
                        "Row {row}: favorite weapon {no} already belongs to another member — skipped"
                    ),
                ));
            }
            Err(e) => return Err(e),
        }
    }

    let members_matched = plan.row_to_uid.len() as u32;
    let members_unmatched = plan.warnings.iter().filter(|w| w.code == "warn_member_unmatched").count() as u32;

    tx.commit()?;

    Ok(ImportResult {
        members_unmatched,
        members_matched,
        weapons_created,
        weapons_matched,
        loans_created,
        loans_skipped,
        open_loans_marked_returned,
        warnings,
    })
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

fn lock<'a>(
    db: &'a State<'_, Db>,
) -> Result<std::sync::MutexGuard<'a, Connection>, AppError> {
    db.0.lock()
        .map_err(|_| AppError::internal("db lock poisoned"))
}

/// Return all sheet names in the workbook (no DB access).
#[tauri::command]
pub fn import_list_sheets(path: String) -> Result<Vec<String>, AppError> {
    let wb: Xlsx<_> = open_workbook(Path::new(&path))
        .map_err(|e| AppError::internal(format!("Cannot open workbook: {e}")))?;
    Ok(wb.sheet_names())
}

/// Parse the sheet, query the DB for matches, return counts + warnings.  No writes.
#[tauri::command]
pub fn import_preview(
    db: State<Db>,
    path: String,
    sheet: String,
) -> Result<ImportPreview, AppError> {
    let parsed = parse_xlsx(Path::new(&path), &sheet)?;
    let conn = lock(&db)?;
    let plan = build_plan(&conn, &parsed)?;
    Ok(plan_to_preview(&plan))
}

/// Parse, plan, and execute under one transaction.  Returns applied counts.
///
/// `mark_open_as_returned`: if true, imported loans without a check-in date are
/// automatically closed on the same day (checked_in_at = checked_out_at).
#[tauri::command]
pub fn import_commit(
    db: State<Db>,
    path: String,
    sheet: String,
    mark_open_as_returned: bool,
) -> Result<ImportResult, AppError> {
    let parsed = parse_xlsx(Path::new(&path), &sheet)?;
    let conn = lock(&db)?;
    let plan = build_plan(&conn, &parsed)?;
    execute(&conn, &plan, mark_open_as_returned)
}

/// Export the unmatched-row list (name/personnummer/weapon-ids) to CSV, using
/// the same conventions as `stats::export_csv`. Re-parses + re-plans, same
/// idempotent pattern as `import_preview`/`import_commit`.
#[tauri::command]
pub fn import_export_unmatched(
    db: State<Db>,
    path: String,
    sheet: String,
    out_path: String,
) -> Result<i64, AppError> {
    let parsed = parse_xlsx(Path::new(&path), &sheet)?;
    let conn = lock(&db)?;
    let plan = build_plan(&conn, &parsed)?;
    let (content, count) = unmatched_csv(&plan);
    std::fs::write(&out_path, content)?;
    Ok(count)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::user_upsert_guest;
    use crate::db::migrated_in_memory;

    fn make_member(row: u32, name: &str, ssn: Option<&str>, loans: Vec<ParsedLoan>) -> ParsedMember {
        ParsedMember {
            row,
            name: name.into(),
            ssn: ssn.map(String::from),
            ssn_key: ssn.and_then(ssn_tail10),
            favorite_weapon_no: None, // override after construction when needed
            loans,
        }
    }

    fn make_loan(weapon_no: &str, date: &str, returned: bool) -> ParsedLoan {
        ParsedLoan {
            weapon_no: weapon_no.into(),
            checked_out_at: format!("{date}T12:00:00+00:00"),
            checked_in_at: if returned {
                Some(format!("{date}T12:00:00+00:00"))
            } else {
                None
            },
        }
    }

    fn parsed_sheet(members: Vec<ParsedMember>) -> ParsedSheet {
        ParsedSheet { members, warnings: Vec::new() }
    }

    fn mk_member_user(conn: &Connection, name: &str, ssn: &str) -> crate::models::User {
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

    // ── parse helpers ──

    #[test]
    fn excel_serial_conversion() {
        // 45875 = 2025-08-06 (verified from real file)
        let result = excel_serial_to_rfc3339(45875.0).unwrap();
        assert!(result.starts_with("2025-08-06"), "{result}");
    }

    #[test]
    fn is_weapon_no_rejects_junk() {
        assert!(is_weapon_no("36"));
        assert!(is_weapon_no("1"));
        assert!(!is_weapon_no(","));
        assert!(!is_weapon_no(" "));
        assert!(!is_weapon_no(""));
        assert!(!is_weapon_no("G17"));
        assert!(!is_weapon_no("950202-1117"));
    }

    // ── planning + execution ──

    #[test]
    fn member_matched_by_ssn_tail10() {
        let conn = migrated_in_memory();
        let existing = mk_member_user(&conn, "Tom Stevens", "19800101-1231");

        let sheet = parsed_sheet(vec![make_member(4, "Tom Stevens", Some("800101-1231"), vec![])]);
        let plan = build_plan(&conn, &sheet).unwrap();
        assert_eq!(plan.row_to_uid.get(&4), Some(&existing.uid));
    }

    #[test]
    fn unmatched_row_is_skipped_and_reported() {
        let conn = migrated_in_memory();
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Nobody Here",
            Some("19800101-1231"),
            vec![make_loan("36", "2025-08-06", true)],
        )]);

        let plan = build_plan(&conn, &sheet).unwrap();
        let preview = plan_to_preview(&plan);
        assert_eq!(preview.loans_to_create, 0);
        assert_eq!(preview.weapons_to_create, 0);
        assert_eq!(preview.members_unmatched, 1);
        let warn = preview.warnings.iter().find(|w| w.code == "warn_member_unmatched");
        assert!(warn.is_some());
        assert_eq!(warn.unwrap().weapon.as_deref(), Some("36"));

        let result = execute(&conn, &plan, false).unwrap();
        assert_eq!(result.loans_created, 0);
        assert_eq!(result.weapons_created, 0);

        let checkout_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM checkouts", [], |r| r.get(0)).unwrap();
        let weapon_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM weapons", [], |r| r.get(0)).unwrap();
        assert_eq!(checkout_count, 0);
        assert_eq!(weapon_count, 0);
    }

    #[test]
    fn tail10_tie_break_prefers_active_member_over_active_guest() {
        let conn = migrated_in_memory();
        // Member stored trimmed-only (create_user does not canonicalise).
        let member = mk_member_user(&conn, "Tom Stevens", "800101-1231");
        // Guest stored canonicalised, same tail-10, also active.
        user_upsert_guest(&conn, "Tom Guest".into(), "19800101-1231".into()).unwrap();

        let sheet = parsed_sheet(vec![make_member(4, "Tom Stevens", Some("19800101-1231"), vec![])]);
        let plan = build_plan(&conn, &sheet).unwrap();
        assert_eq!(plan.row_to_uid.get(&4), Some(&member.uid));
    }

    #[test]
    fn loan_dedup_on_second_commit() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Tom",
            Some("19890330-0001"),
            vec![make_loan("36", "2025-08-06", true)],
        )]);

        // First commit creates the weapon and loan.
        let plan1 = build_plan(&conn, &sheet).unwrap();
        let r1 = execute(&conn, &plan1, false).unwrap();
        assert_eq!(r1.weapons_created, 1);
        assert_eq!(r1.loans_created, 1);
        assert_eq!(r1.loans_skipped, 0);

        // Second commit: everything matched / deduped.
        let plan2 = build_plan(&conn, &sheet).unwrap();
        let r2 = execute(&conn, &plan2, false).unwrap();
        assert_eq!(r2.weapons_created, 0);
        assert_eq!(r2.loans_created, 0);
        assert_eq!(r2.loans_skipped, 1);
    }

    #[test]
    fn open_loan_has_null_checked_in_at() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Tom",
            Some("19890330-0001"),
            vec![make_loan("36", "2025-08-06", false)],
        )]);
        let plan = build_plan(&conn, &sheet).unwrap();
        execute(&conn, &plan, false).unwrap();

        let checked_in_at: Option<String> = conn
            .query_row("SELECT checked_in_at FROM checkouts LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(checked_in_at.is_none());
    }

    #[test]
    fn import_operator_created_once() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Tom",
            Some("19890330-0001"),
            vec![make_loan("36", "2025-08-06", true)],
        )]);

        let p1 = build_plan(&conn, &sheet).unwrap();
        execute(&conn, &p1, false).unwrap();
        let p2 = build_plan(&conn, &sheet).unwrap();
        execute(&conn, &p2, false).unwrap();

        let import_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users WHERE name='Import'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(import_count, 1);
    }

    #[test]
    fn mark_open_as_returned_closes_loan() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Tom",
            Some("19890330-0001"),
            vec![make_loan("36", "2025-08-06", false)], // open loan
        )]);
        let plan = build_plan(&conn, &sheet).unwrap();
        assert_eq!(plan_to_preview(&plan).open_loans, 1);

        let result = execute(&conn, &plan, true).unwrap();
        assert_eq!(result.open_loans_marked_returned, 1);

        let checked_in_at: Option<String> = conn
            .query_row("SELECT checked_in_at FROM checkouts LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(checked_in_at.is_some(), "loan should be closed");
    }

    #[test]
    fn weapon_reused_when_already_active() {
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let existing_w = weapon_create(
            &conn,
            NewWeapon {
                display_id: Some("36".into()),
                brand: Some("Glock".into()),
                model: None,
                serial: None,
                caliber: None,
                notes: None,
            },
        )
        .unwrap();

        let sheet = parsed_sheet(vec![make_member(
            4,
            "Tom",
            Some("19890330-0001"),
            vec![make_loan("36", "2025-08-06", true)],
        )]);
        let plan = build_plan(&conn, &sheet).unwrap();
        assert_eq!(plan.weapons[0].existing_uid, Some(existing_w.uid));
    }

    // ── favorite weapon ──

    #[test]
    fn favorite_weapon_parsed_and_set_on_commit() {
        // Scenario 1: matched member row has favorite_weapon_no "7"; no loan
        // references "7". After commit: member's preferred_weapon_uid = the
        // created weapon with tag "7".
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Tom", "19890330-0001");
        let mut member = make_member(4, "Tom", Some("19890330-0001"), vec![]);
        member.favorite_weapon_no = Some("7".into());
        let sheet = parsed_sheet(vec![member]);

        let plan = build_plan(&conn, &sheet).unwrap();
        // "7" must be in weapon actions even though no loan references it.
        assert!(plan.weapons.iter().any(|w| w.display_id == "7"));

        let result = execute(&conn, &plan, false).unwrap();
        assert_eq!(result.weapons_created, 1);
        assert!(result.warnings.iter().all(|w| w.code != "warn_favorite_conflict"));

        // Member's preferred_weapon_uid must be the weapon with display_id "7".
        let (member_pref, weapon_uid): (Option<i64>, i64) = conn
            .query_row(
                "SELECT u.preferred_weapon_uid, w.uid \
                 FROM users u, weapons w \
                 WHERE u.name = 'Tom' AND w.display_id = '7'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(member_pref, Some(weapon_uid));
    }

    #[test]
    fn favorite_weapon_conflict_first_row_wins() {
        // Scenario 2: two matched members share the same favorite "7".
        // Row 4 (lower row) gets it; row 5 receives warn_favorite_conflict.
        let conn = migrated_in_memory();
        mk_member_user(&conn, "Alice", "19890330-0001");
        mk_member_user(&conn, "Bob", "19900101-0002");
        let mut m1 = make_member(4, "Alice", Some("19890330-0001"), vec![]);
        m1.favorite_weapon_no = Some("7".into());
        let mut m2 = make_member(5, "Bob", Some("19900101-0002"), vec![]);
        m2.favorite_weapon_no = Some("7".into());
        let sheet = parsed_sheet(vec![m1, m2]);

        let plan = build_plan(&conn, &sheet).unwrap();
        let result = execute(&conn, &plan, false).unwrap();

        // Row 5 should have the conflict warning.
        let conflict = result.warnings.iter().find(|w| w.code == "warn_favorite_conflict");
        assert!(conflict.is_some(), "expected warn_favorite_conflict for second member");
        assert_eq!(conflict.unwrap().row, 5);

        // Alice (row 4) has the weapon; Bob (row 5) does not.
        let alice_pref: Option<i64> = conn
            .query_row(
                "SELECT preferred_weapon_uid FROM users WHERE name = 'Alice'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let bob_pref: Option<i64> = conn
            .query_row(
                "SELECT preferred_weapon_uid FROM users WHERE name = 'Bob'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(alice_pref.is_some(), "Alice should have the preferred weapon");
        assert!(bob_pref.is_none(), "Bob should have no preferred weapon");
    }

    #[test]
    fn favorite_weapon_not_overwritten_for_existing_member() {
        // Scenario 3: pre-create member+weapon and set preference to W_A.
        // Import file says W_B — after commit, preference must still be W_A.
        let conn = migrated_in_memory();
        let member = mk_member_user(&conn, "Carol", "19920101-0003");
        let w_a = weapon_create(
            &conn,
            NewWeapon {
                display_id: Some("11".into()),
                brand: None, model: None, serial: None, caliber: None, notes: None,
            },
        )
        .unwrap();
        let _w_b = weapon_create(
            &conn,
            NewWeapon {
                display_id: Some("22".into()),
                brand: None, model: None, serial: None, caliber: None, notes: None,
            },
        )
        .unwrap();
        // Pre-set preference to W_A.
        user_set_preferred_weapon(&conn, member.uid, Some(w_a.uid)).unwrap();

        // Import says favorite is "22" (W_B).
        let mut m = make_member(4, "Carol", Some("19920101-0003"), vec![]);
        m.favorite_weapon_no = Some("22".into());
        let sheet = parsed_sheet(vec![m]);

        let plan = build_plan(&conn, &sheet).unwrap();
        let result = execute(&conn, &plan, false).unwrap();

        // No conflict warning — silence is the correct response.
        assert!(result.warnings.iter().all(|w| w.code != "warn_favorite_conflict"));

        // Preference is still W_A.
        let pref: Option<i64> = conn
            .query_row(
                "SELECT preferred_weapon_uid FROM users WHERE uid = ?1",
                params![member.uid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pref, Some(w_a.uid));
    }

    #[test]
    fn favorite_skipped_for_inactive_matched_member() {
        // Pre-create a member, deactivate them, then import a sheet that matches
        // them and references a favorite weapon.  The member's preferred_weapon_uid
        // must stay NULL and the warning code must be present.
        let conn = migrated_in_memory();
        let member = mk_member_user(&conn, "Dave Inactive", "19850101-0099");
        // Deactivate (clear tag so the partial-unique index doesn't block us).
        crate::commands::user_set_active(&conn, member.uid, false, true).unwrap();

        // Import: row 3, same SSN, favorite weapon "55".
        let mut m = make_member(3, "Dave Inactive", Some("19850101-0099"), vec![]);
        m.favorite_weapon_no = Some("55".into());
        let sheet = parsed_sheet(vec![m]);

        let plan = build_plan(&conn, &sheet).unwrap();
        let result = execute(&conn, &plan, false).unwrap();

        // Warning must be present.
        let warn = result.warnings.iter().find(|w| w.code == "warn_favorite_inactive_member");
        assert!(warn.is_some(), "expected warn_favorite_inactive_member");
        assert_eq!(warn.unwrap().row, 3);

        // Member's preference must still be NULL.
        let pref: Option<i64> = conn
            .query_row(
                "SELECT preferred_weapon_uid FROM users WHERE uid = ?1",
                params![member.uid],
                |r| r.get(0),
            )
            .unwrap();
        assert!(pref.is_none(), "inactive member must not gain a favorite");
    }

    // ── unmatched export ──

    #[test]
    fn unmatched_csv_has_bom_and_semicolons() {
        let conn = migrated_in_memory();
        let sheet = parsed_sheet(vec![make_member(
            4,
            "Nobody",
            Some("19800101-1231"),
            vec![make_loan("36", "2025-08-06", true)],
        )]);
        let plan = build_plan(&conn, &sheet).unwrap();
        let (content, count) = unmatched_csv(&plan);
        assert_eq!(count, 1);
        assert!(content.starts_with('\u{FEFF}'));
        let lines: Vec<&str> = content.trim_start_matches('\u{FEFF}').split("\r\n").collect();
        assert_eq!(lines[0], "Rad;Namn;Personnummer;Vapen-ID");
        assert!(lines[1].starts_with("4;Nobody;19800101-1231;36"));
    }
}
