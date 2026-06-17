//! Dev DB seeding CLI — `npm run seed` (= `cargo run --bin seed`).
//!
//! Opens the SAME SQLite file the dev app uses (resolved without a Tauri
//! AppHandle via `db::dev_db_path`), then wipes + refills it with mock data.

use shooting_range_log_lib::{db, seed};

fn main() {
    let path = db::dev_db_path().expect("resolve dev DB path");
    let conn = db::open_migrated(&path).expect("open + migrate dev DB");
    seed::seed_dev_database(&conn).expect("seed dev DB");
    println!("Seeded dev DB at {}", path.display());
}
