//! Dev DB wipe CLI — `npm run wipe [-- <target>]`.
//!
//! Opens the same SQLite file the dev app uses, then deletes rows from the
//! chosen scope. The schema, migrations, and app_meta are left intact.
//!
//! Targets:
//!   full     — all domain tables (default)
//!   users    — users + dependent logs (checkouts, service log, debts); keeps weapons
//!   weapons  — weapons + dependent logs; keeps users
//!   logs     — log tables only (checkouts, service log, debts); keeps users + weapons

use shooting_range_log_lib::{db, seed};

fn main() {
    let target = std::env::args().nth(1).unwrap_or_else(|| "full".to_string());

    let path = db::dev_db_path().expect("resolve dev DB path");
    let conn = db::open_migrated(&path).expect("open + migrate dev DB");

    match target.as_str() {
        "full" => seed::wipe_all(&conn).expect("wipe all"),
        "users" => seed::wipe_users(&conn).expect("wipe users"),
        "weapons" => seed::wipe_weapons(&conn).expect("wipe weapons"),
        "logs" => seed::wipe_logs(&conn).expect("wipe logs"),
        other => {
            eprintln!("Unknown wipe target '{other}'. Valid: full, users, weapons, logs");
            std::process::exit(1);
        }
    }

    println!("Wiped [{target}] in dev DB at {}", path.display());
}
