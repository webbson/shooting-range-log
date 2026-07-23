//! Dev-only mock data seeding.
//!
//! NOT used by the running app — invoked by the `seed` binary (`npm run seed`),
//! which opens the same DB file the dev app uses and calls `seed_dev_database`.
//! Each run WIPES the domain tables and rebuilds a deterministic dataset, so dev
//! always has a known, full set to exercise every screen against.
//!
//! Data is built by reusing the real domain create fns (`user_create`,
//! `weapon_create`, `do_checkout`, `debt::add`, `service::add`, …) so it goes
//! through the same validation the app does — never raw inserts (except backdating
//! timestamps, which the create fns don't expose).
//!
//! KEEP IN SYNC: when you add a new entity, field, or log type, extend the seed
//! here so it's exercised too. See CLAUDE.md "Dev data".

use chrono::{Duration, Utc};
use rusqlite::{params, Connection};

use crate::checkout::{do_checkin, do_checkout};
use crate::commands::{
    user_create, user_set_active, user_set_preferred_weapon, user_upsert_guest, weapon_create,
    weapon_set_active, weapon_set_tags,
};
use crate::error::AppError;
use crate::models::{NewUser, NewWeapon};
use crate::{debt, service};

// ---- Sample value tables — extend freely; everything below indexes into these ----
const FIRST_NAMES: &[&str] = &[
    "Anna", "Björn", "Carl", "Diana", "Erik", "Frida", "Gustav", "Hanna", "Ivar", "Johanna",
    "Karl", "Lena", "Magnus", "Nora", "Olof", "Petra", "Rune", "Sofia", "Tomas", "Ulla",
];
const LAST_NAMES: &[&str] = &[
    "Andersson", "Bergström", "Carlsson", "Dahl", "Eriksson", "Forsberg", "Gustafsson", "Holm",
    "Isaksson", "Johansson",
];
const STREETS: &[&str] = &["Storgatan", "Kungsgatan", "Skolvägen", "Parkvägen", "Industrigatan"];
const BRANDS: &[&str] = &[
    "Glock", "Sig Sauer", "CZ", "Beretta", "Walther", "Heckler & Koch", "Smith & Wesson", "Ruger",
];
const MODELS: &[&str] = &["17", "P226", "Shadow 2", "92FS", "PPQ", "USP", "686", "Mark IV"];
const CALIBERS: &[&str] = &["9mm", "9mm", ".22LR", ".45 ACP", ".357", "9mm"];
const DEBT_REASONS: &[&str] = &[
    "Banavgift",
    "Ammunition",
    "Skadad måltavla",
    "Förbrukningsmaterial",
    "Sen återlämning",
];
const SERVICE_DESCS: &[&str] = &[
    "Rengöring och smörjning",
    "Byte av rekylfjäder",
    "Pipinspektion",
    "Funktionskontroll",
    "Justering av riktmedel",
    "Byte av slagstift",
];

// ---- Counts — tweak to taste ----
const N_USERS: usize = 20;
const N_WEAPONS: usize = 20;
const N_STAFF: usize = 3; // first N_STAFF users are operators (is_staff)
const N_OPEN: usize = 4; // weapons left currently checked out
const N_DEBTS: usize = 10;
const N_SERVICE: usize = 15;

fn days_ago(n: i64) -> String {
    (Utc::now() - Duration::days(n.max(0))).to_rfc3339()
}

fn delete_tables(conn: &Connection, tables: &[&str]) -> Result<(), AppError> {
    for table in tables {
        conn.execute(&format!("DELETE FROM {table}"), [])?;
    }
    Ok(())
}

/// Wipe all domain rows (child → parent; `foreign_keys` is ON).
/// `app_meta` and the schema itself are left intact.
pub fn wipe_all(conn: &Connection) -> Result<(), AppError> {
    // Clear the weapon FK on users first so weapons can be deleted before users.
    // ponytail: targeted NULL rather than reordering, since users is both parent (checkouts/debts) and child (preferred_weapon_uid → weapons).
    conn.execute("UPDATE users SET preferred_weapon_uid = NULL", [])?;
    delete_tables(conn, &["debts", "weapon_service_log", "checkouts", "weapons", "users"])
}

/// Wipe users and all rows that reference them (checkouts, service log, debts).
/// Weapons are kept.
pub fn wipe_users(conn: &Connection) -> Result<(), AppError> {
    delete_tables(conn, &["debts", "weapon_service_log", "checkouts", "users"])
}

/// Wipe weapons and all rows that reference them (checkouts, service log, debts).
/// Users are kept.
pub fn wipe_weapons(conn: &Connection) -> Result<(), AppError> {
    // Clear the weapon FK on users first so weapons can be deleted while users are kept.
    // ponytail: same fix as wipe_all — users.preferred_weapon_uid → weapons FK.
    conn.execute("UPDATE users SET preferred_weapon_uid = NULL", [])?;
    delete_tables(conn, &["debts", "weapon_service_log", "checkouts", "weapons"])
}

/// Wipe log/transaction tables only (checkouts, service log, debts).
/// Users and weapons are kept.
pub fn wipe_logs(conn: &Connection) -> Result<(), AppError> {
    delete_tables(conn, &["debts", "weapon_service_log", "checkouts"])
}

/// Wipe the dev DB and rebuild a full deterministic dataset.
pub fn seed_dev_database(conn: &Connection) -> Result<(), AppError> {
    wipe_all(conn)?;

    // --- Users (no display_id — member tags are dead, ID removed from the UI);
    // first N_STAFF are operators. ---
    let mut user_uids = Vec::with_capacity(N_USERS);
    for i in 0..N_USERS {
        let first = FIRST_NAMES[i % FIRST_NAMES.len()];
        let last = LAST_NAMES[i % LAST_NAMES.len()];
        let n = i + 1;
        let u = user_create(
            conn,
            NewUser {
                display_id: None,
                name: format!("{first} {last}"),
                email: Some(format!(
                    "{}.{}@example.com",
                    first.to_lowercase(),
                    last.to_lowercase()
                )),
                phone: Some(format!("070-{:07}", 1_000_000 + n)),
                address: Some(format!("{} {n}", STREETS[i % STREETS.len()])),
                ssn: Some(format!(
                    "19{:02}{:02}{:02}-{:04}",
                    60 + (i % 30),
                    1 + (i % 12),
                    1 + (i % 28),
                    1000 + n
                )),
                is_staff: i < N_STAFF,
                is_admin: i == 0, // first operator is the seeded admin
                notes: None,
            },
        )?;
        user_uids.push(u.uid);
    }
    let operators: Vec<i64> = user_uids[..N_STAFF].to_vec();
    let op = |k: usize| operators[k % operators.len()];

    // --- Weapons (display_id "1".."20", globally-unique serial "SN-0001"..). ---
    let mut weapon_uids = Vec::with_capacity(N_WEAPONS);
    for i in 0..N_WEAPONS {
        let n = i + 1;
        let w = weapon_create(
            conn,
            NewWeapon {
                display_id: Some(n.to_string()),
                brand: Some(BRANDS[i % BRANDS.len()].to_string()),
                model: Some(MODELS[i % MODELS.len()].to_string()),
                serial: Some(format!("SN-{n:04}")),
                caliber: Some(CALIBERS[i % CALIBERS.len()].to_string()),
                notes: None,
            },
        )?;
        weapon_uids.push(w.uid);
    }

    // --- Preferred weapons: a few members favor a specific weapon (exclusive,
    // one member per weapon — mirrors the partial unique index). ---
    for (ui, wi) in [(2usize, 0usize), (5, 3), (9, 7)] {
        user_set_preferred_weapon(conn, user_uids[ui], Some(weapon_uids[wi]))?;
    }

    // --- Checkout history. The first `returned` weapons get a couple of returned
    // sessions spread across the last ~60 days; the last N_OPEN weapons are left
    // currently checked out (one open row each — do_checkout rejects a 2nd open). ---
    let returned = N_WEAPONS - N_OPEN;
    let mut checkout_ids: Vec<i64> = Vec::new();
    let mut k = 0usize;
    for round in 0..2 {
        for wi in 0..returned {
            let weapon = weapon_uids[wi];
            let user = user_uids[(wi + round * 7) % N_USERS];
            let c = do_checkout(conn, weapon, user, op(k), None, false)?;
            do_checkin(conn, c.id, op(k + 1))?;
            // Backdate both timestamps (create fns stamp "now"): out older, in newer.
            let out_day = 5 + ((k as i64 * 13) % 55);
            let in_day = (out_day - 1 - (k as i64 % 4)).max(0);
            conn.execute(
                "UPDATE checkouts SET checked_out_at = ?2, checked_in_at = ?3 WHERE id = ?1",
                params![c.id, days_ago(out_day), days_ago(in_day)],
            )?;
            checkout_ids.push(c.id);
            k += 1;
        }
    }
    for j in 0..N_OPEN {
        let weapon = weapon_uids[returned + j];
        let user = user_uids[(N_STAFF + 2 + j) % N_USERS]; // active, not retired below
        // Exercise assign=true on one open checkout (weapon outside the preferred
        // triples above); transfer-from-other-member is covered by a cargo test.
        let assign = j == 0;
        let c = do_checkout(conn, weapon, user, op(j), None, assign)?;
        conn.execute(
            "UPDATE checkouts SET checked_out_at = ?2 WHERE id = ?1",
            params![c.id, days_ago(j as i64)],
        )?;
        checkout_ids.push(c.id);
    }

    // --- Guests: one repeat visitor with an open loan, one without history. ---
    let g1 = user_upsert_guest(conn, "Gustav Gästsson".into(), "19870707-7777".into())?.uid;
    user_upsert_guest(conn, "Greta Gästberg".into(), "19920202-2222".into())?;
    // weapon_uids[0] was checked out+in above (returned round-robin) so it's free.
    let c = do_checkout(conn, weapon_uids[0], g1, op(0), None, false)?;
    checkout_ids.push(c.id);

    // --- Weapon condition tags: current-state flags, independent of checkout status. ---
    weapon_set_tags(conn, weapon_uids[1], true, false, false, false, Some("Kolven glappar".into()))?;
    weapon_set_tags(conn, weapon_uids[2], false, true, true, false, None)?;
    weapon_set_tags(conn, weapon_uids[4], false, false, false, true, None)?;

    // --- Debts: some settled, some linked to a real checkout, backdated. ---
    for i in 0..N_DEBTS {
        let user = user_uids[(i * 3) % N_USERS];
        let amount = 50 + (i as i64 % 6) * 50; // 50..=300 kr
        let linked = if i % 3 == 0 && !checkout_ids.is_empty() {
            Some(checkout_ids[i % checkout_ids.len()])
        } else {
            None
        };
        let d = debt::add(
            conn,
            user,
            op(i),
            amount,
            Some(DEBT_REASONS[i % DEBT_REASONS.len()].to_string()),
            linked,
        )?;
        conn.execute(
            "UPDATE debts SET created_at = ?2 WHERE id = ?1",
            params![d.id, days_ago(50 - (i as i64 * 4))],
        )?;
        if i % 2 == 0 {
            debt::settle(conn, d.id, op(i))?;
            conn.execute(
                "UPDATE debts SET settled_at = ?2 WHERE id = ?1",
                params![d.id, days_ago(45 - (i as i64 * 4))],
            )?;
        }
    }

    // --- Service logs: backdated natively via service::add's serviced_at param. ---
    for i in 0..N_SERVICE {
        let weapon = weapon_uids[(i * 2) % N_WEAPONS];
        let notes = if i % 4 == 0 {
            Some(format!("Utförd av tekniker {}", 1 + i % 3))
        } else {
            None
        };
        service::add(
            conn,
            weapon,
            op(i),
            SERVICE_DESCS[i % SERVICE_DESCS.len()].to_string(),
            notes,
            Some(days_ago(3 + (i as i64 * 4))),
        )?;
    }

    // --- Retire a few entities LAST (after their history exists) so logs/lists
    // exercise live "[disabled]" rendering + the show-inactive toggle. Picked from
    // returned weapons / non-open-holder users so nothing inactive is left "out". ---
    user_set_active(conn, user_uids[N_USERS - 2], false, true)?; // clear tag
    user_set_active(conn, user_uids[N_USERS - 1], false, false)?; // keep tag
    weapon_set_active(conn, weapon_uids[returned - 2], false, Some("Trasig".into()), false)?;
    weapon_set_active(conn, weapon_uids[returned - 1], false, Some("Uttjänt".into()), true)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrated_in_memory;

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn seeds_expected_counts_and_is_idempotent() {
        let conn = migrated_in_memory();
        seed_dev_database(&conn).unwrap();

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM users"), 22); // 20 members + 2 guests
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM weapons"), 20);
        assert!(count(&conn, "SELECT COUNT(*) FROM checkouts") > 0);
        assert!(count(&conn, "SELECT COUNT(*) FROM debts") > 0);
        assert!(count(&conn, "SELECT COUNT(*) FROM weapon_service_log") > 0);
        assert!(count(&conn, "SELECT COUNT(*) FROM checkouts WHERE checked_in_at IS NULL") >= 1);
        assert!(count(&conn, "SELECT COUNT(*) FROM debts WHERE settled_at IS NOT NULL") >= 1);
        assert!(count(&conn, "SELECT COUNT(*) FROM users WHERE active = 0") >= 1);
        assert!(count(&conn, "SELECT COUNT(*) FROM weapons WHERE active = 0") >= 1);

        // Re-seed wipes first → counts stay the same, not doubled.
        seed_dev_database(&conn).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM users"), 22);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM weapons"), 20);
    }

    #[test]
    fn wipe_weapons_succeeds_with_preferred_weapon_refs() {
        let conn = migrated_in_memory();
        seed_dev_database(&conn).unwrap();
        // Weapons are FK-referenced from users.preferred_weapon_uid; wipe_weapons must
        // clear those refs first or the DELETE fails with FOREIGN KEY constraint failed.
        wipe_weapons(&conn).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM weapons"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM users"), 22); // users kept
    }
}
