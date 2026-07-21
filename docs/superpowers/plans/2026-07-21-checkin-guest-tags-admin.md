# Checkin Split + Guest Loans + Weapon Tags + Admin Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split checkout/checkin into two pages with an open-loan nav badge, add guest loans (name+SSN), weapon tag columns with filtering, and an `is_admin` UI permission level.

**Architecture:** One migration (0004) adds `users.is_guest`, `users.is_admin`, and five tag columns on `weapons`. New Rust commands `upsert_guest`, `promote_guest`, `has_admin`, `set_weapon_tags`; `evaluate_checkout` reports active tags. Frontend: new `CheckinPage` (open-loans list moves there), `GuestModal`, `TagModal`, `useIsAdmin` hook for UI-only gating.

**Tech Stack:** Tauri 2 (Rust, rusqlite, rusqlite_migration), React + TypeScript + Mantine v9, TanStack Query, Zustand, react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-21-checkin-guest-tags-admin-design.md`

## Global Constraints

- All DB access through Rust `#[tauri::command]`s; validation in Rust. Never add `tauri-plugin-sql`.
- Never edit shipped migrations 0001–0003 — append 0004 only.
- Log tables stay append-only; log reads resolve identity live by uid (no snapshots).
- Errors via `AppError { code, message, params }` helpers; frontend translates via `errorMessage(e, t)`.
- All user-facing strings in `src/i18n.ts`, BOTH `sv` and `en`. Default language Swedish.
- Tauri v2 args: JS camelCase → Rust snake_case. Struct inputs wrapped: `invoke('cmd', { input })`.
- Money integer kronor; time UTC RFC3339.
- Admin gating is UI-only; backend commands are NOT gated (approved decision).
- Every task ends with `cargo test --manifest-path src-tauri/Cargo.toml` and/or `npm run build` green, then a commit on branch `feat/checkin-guest-tags-admin` (already created).
- Work directory: `/Users/tom.stevens/git/shooting-range-log`.
- Known oddity: `src/WeaponsPage.tsx` contains 2 literal NUL bytes (~line 114) — git treats it as binary. Do not "fix" this; edit around it (BACKLOG item).

---

### Task 1: Migration 0004 + models

**Files:**
- Modify: `src-tauri/src/db.rs` (SCHEMA_V4 + migrations vec + version test)
- Modify: `src-tauri/src/models.rs` (User/Weapon structs, COLS, NewUser/UpdateUser)
- Modify: `src-tauri/src/commands.rs` (user_create/user_update SQL + test fixtures)
- Modify: `src-tauri/src/checkout.rs` (test fixture `mk_user`)
- Modify: `src-tauri/src/seed.rs` (NewUser literal gains field)

**Interfaces:**
- Produces: `users.is_guest`, `users.is_admin`, `weapons.tag_needs_service`, `weapons.tag_broken`, `weapons.tag_missing_parts`, `weapons.tag_needs_cleaning`, `weapons.tag_comment` columns; `User { is_guest: bool, is_admin: bool }`; `Weapon { tag_needs_service: bool, tag_broken: bool, tag_missing_parts: bool, tag_needs_cleaning: bool, tag_comment: Option<String> }`; `NewUser`/`UpdateUser` gain `is_admin: bool` (serde default). `is_guest` is NOT on NewUser/UpdateUser.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/db.rs` tests, change the version assertion:

```rust
    #[test]
    fn migrations_apply_to_in_memory_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 4, "four migrations applied");
    }
```

Add to `src-tauri/src/commands.rs` tests:

```rust
    #[test]
    fn new_user_defaults_not_guest_not_admin() {
        let conn = migrated_in_memory();
        let u = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        assert!(!u.is_guest);
        assert!(!u.is_admin);
    }

    #[test]
    fn new_weapon_defaults_no_tags() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        assert!(!w.tag_needs_service && !w.tag_broken && !w.tag_missing_parts && !w.tag_needs_cleaning);
        assert_eq!(w.tag_comment, None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compile error (`is_guest` not on `User`) — that counts as the failing state.

- [ ] **Step 3: Implement migration 0004**

In `src-tauri/src/db.rs`, after `SCHEMA_V3`:

```rust
/// Guest members, admin level, and weapon condition tags (migration 0004).
/// Tags are current state (columns, not a log); the fixed tag set is defined in
/// code — adding a tag later = one new column migration + i18n keys.
const SCHEMA_V4: &str = r#"
ALTER TABLE users   ADD COLUMN is_guest           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users   ADD COLUMN is_admin           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_needs_service  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_broken         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_missing_parts  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_needs_cleaning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_comment        TEXT;
"#;
```

Append to the `migrations()` vec:

```rust
        // 0004 — guests, admin flag, weapon tags.
        M::up(SCHEMA_V4),
```

- [ ] **Step 4: Update models.rs**

`USER_COLS` becomes:

```rust
pub const USER_COLS: &str =
    "uid, display_id, name, email, phone, address, ssn, is_staff, is_guest, is_admin, active, notes, preferred_weapon_uid, created_at, updated_at";
```

`WEAPON_COLS` becomes:

```rust
pub const WEAPON_COLS: &str =
    "uid, display_id, brand, model, serial, caliber, active, inactive_reason, notes, tag_needs_service, tag_broken, tag_missing_parts, tag_needs_cleaning, tag_comment, created_at, updated_at";
```

`User` struct: add after `is_staff`:

```rust
    pub is_guest: bool,
    pub is_admin: bool,
```

`User::from_row`: add after the `is_staff` line:

```rust
            is_guest: row.get("is_guest")?,
            is_admin: row.get("is_admin")?,
```

`Weapon` struct: add after `notes`:

```rust
    pub tag_needs_service: bool,
    pub tag_broken: bool,
    pub tag_missing_parts: bool,
    pub tag_needs_cleaning: bool,
    pub tag_comment: Option<String>,
```

`Weapon::from_row`: add matching `row.get("tag_needs_service")?` etc. lines after `notes`.

`NewUser` and `UpdateUser`: add after `is_staff`:

```rust
    #[serde(default)]
    pub is_admin: bool,
```

(`NewWeapon`/`UpdateWeapon` unchanged — tags are set only via `set_weapon_tags` in Task 3.)

- [ ] **Step 5: Update user_create / user_update SQL in commands.rs**

`user_create` INSERT becomes:

```rust
    conn.execute(
        "INSERT INTO users
           (display_id, name, email, phone, address, ssn, is_staff, is_admin, active, notes, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10,?10)",
        params![
            display_id,
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            input.is_admin,
            norm(input.notes),
            now,
        ],
    )?;
```

`user_update` UPDATE becomes:

```rust
    conn.execute(
        "UPDATE users SET
           display_id = ?2, name = ?3, email = ?4, phone = ?5,
           address = ?6, ssn = ?7, is_staff = ?8, is_admin = ?9, notes = ?10, updated_at = ?11
         WHERE uid = ?1",
        params![
            input.uid,
            display_id,
            name,
            norm(input.email),
            norm(input.phone),
            norm(input.address),
            norm(input.ssn),
            input.is_staff,
            input.is_admin,
            norm(input.notes),
            now_utc(),
        ],
    )?;
```

- [ ] **Step 6: Fix every NewUser struct literal**

`NewUser` gained `is_admin`. Fix all literal construction sites (compiler will list them): `commands.rs` test helper `new_user(..)` (add `is_admin: false`), `checkout.rs` test helper `mk_user(..)` (add `is_admin: false`), `src-tauri/src/seed.rs` (~line 124 `user_create` call — add `is_admin: false` for now; Task 9 makes one operator admin), and `src-tauri/src/import.rs` if it builds `NewUser` (grep `NewUser {` — add `is_admin: false`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass, incl. the two new tests and the v4 assertion.

- [ ] **Step 8: Commit**

```bash
git add -A src-tauri && git commit -m "feat(db): migration 0004 — is_guest/is_admin on users, tag columns on weapons"
```

---

### Task 2: Guest + admin backend commands

**Files:**
- Modify: `src-tauri/src/error.rs` (new helpers)
- Modify: `src-tauri/src/commands.rs` (inner fns + wrappers + tests)
- Modify: `src-tauri/src/checkout.rs` (`OpenCheckout.user_is_guest`)
- Modify: `src-tauri/src/logs.rs` (`CheckoutLog.user_is_guest`)
- Modify: `src-tauri/src/lib.rs` (register commands)

**Interfaces:**
- Consumes: Task 1 columns/structs.
- Produces: commands `upsert_guest(name: String, ssn: String) -> User`, `promote_guest(uid: i64) -> User`, `has_admin() -> bool`; error codes `err_ssn_required`, `err_ssn_belongs_to_member`, `err_not_a_guest`; `OpenCheckout { user_is_guest: bool }` (serialized `userIsGuest`); `CheckoutLog { user_is_guest: bool }`.

- [ ] **Step 1: Write failing tests in commands.rs**

```rust
    #[test]
    fn upsert_guest_creates_and_reuses_by_ssn() {
        let conn = migrated_in_memory();
        let g = user_upsert_guest(&conn, "Gunnar Gäst".into(), "19900101-1234".into()).unwrap();
        assert!(g.is_guest);
        assert!(g.active);
        assert_eq!(g.display_id, None);
        // Repeat visit: same SSN → same row, name NOT overwritten.
        let g2 = user_upsert_guest(&conn, "Other Name".into(), "19900101-1234".into()).unwrap();
        assert_eq!(g2.uid, g.uid);
        assert_eq!(g2.name, "Gunnar Gäst");
    }

    #[test]
    fn upsert_guest_rejects_member_ssn_and_requires_fields() {
        let conn = migrated_in_memory();
        let mut member = new_user("Anna", Some("10"), false);
        member.ssn = Some("19850505-5555".into());
        user_create(&conn, member).unwrap();
        let err = user_upsert_guest(&conn, "Anna Igen".into(), "19850505-5555".into()).unwrap_err();
        assert_eq!(err.code, "err_ssn_belongs_to_member");
        let err = user_upsert_guest(&conn, "NoSsn".into(), "  ".into()).unwrap_err();
        assert_eq!(err.code, "err_ssn_required");
        let err = user_upsert_guest(&conn, " ".into(), "19900101-1234".into()).unwrap_err();
        assert_eq!(err.code, "err_name_required");
    }

    #[test]
    fn promote_guest_clears_flag_and_rejects_non_guests() {
        let conn = migrated_in_memory();
        let g = user_upsert_guest(&conn, "Gunnar".into(), "19900101-1234".into()).unwrap();
        let m = user_promote_guest(&conn, g.uid).unwrap();
        assert!(!m.is_guest);
        let err = user_promote_guest(&conn, m.uid).unwrap_err();
        assert_eq!(err.code, "err_not_a_guest");
        let err = user_promote_guest(&conn, 9999).unwrap_err();
        assert_eq!(err.code, "err_user_not_found");
    }

    #[test]
    fn admin_exists_reflects_active_admins() {
        let conn = migrated_in_memory();
        assert!(!admin_exists(&conn).unwrap());
        let mut nu = new_user("Boss", Some("1"), true);
        nu.is_admin = true;
        let boss = user_create(&conn, nu).unwrap();
        assert!(admin_exists(&conn).unwrap());
        user_set_active(&conn, boss.uid, false, false).unwrap();
        assert!(!admin_exists(&conn).unwrap());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compile error — `user_upsert_guest` not found.

- [ ] **Step 3: Add error helpers in error.rs**

```rust
    pub fn ssn_required() -> Self {
        AppError::new("err_ssn_required", "SSN is required for a guest.", json!({}))
    }

    pub fn ssn_belongs_to_member(name: &str) -> Self {
        AppError::new(
            "err_ssn_belongs_to_member",
            format!("SSN belongs to member {name} — use a normal member checkout."),
            json!({ "name": name }),
        )
    }

    pub fn not_a_guest() -> Self {
        AppError::new("err_not_a_guest", "User is not a guest.", json!({}))
    }
```

- [ ] **Step 4: Implement inner fns in commands.rs**

```rust
/// Guest checkout entry: find an active user by SSN or create a guest.
/// Active guest with this SSN → returned as-is (name is not overwritten).
/// Active member with this SSN → error (use the normal member flow).
pub(crate) fn user_upsert_guest(
    conn: &Connection,
    name: String,
    ssn: String,
) -> Result<User, AppError> {
    let ssn = norm(Some(ssn)).ok_or_else(AppError::ssn_required)?;
    let name = require_name(name)?;
    let sql = format!("SELECT {USER_COLS} FROM users WHERE ssn = ?1 AND active = 1");
    let existing = conn
        .query_row(&sql, params![ssn], |r| User::from_row(r))
        .optional()?;
    if let Some(u) = existing {
        if u.is_guest {
            return Ok(u);
        }
        return Err(AppError::ssn_belongs_to_member(&u.name));
    }
    let now = now_utc();
    conn.execute(
        "INSERT INTO users (name, ssn, is_guest, active, created_at, updated_at)
         VALUES (?1, ?2, 1, 1, ?3, ?3)",
        params![name, ssn, now],
    )?;
    user_require(conn, conn.last_insert_rowid())
}

/// Admin-only in the UI: turn a guest into a normal member.
pub(crate) fn user_promote_guest(conn: &Connection, uid: i64) -> Result<User, AppError> {
    let u = user_require(conn, uid)?;
    if !u.is_guest {
        return Err(AppError::not_a_guest());
    }
    conn.execute(
        "UPDATE users SET is_guest = 0, updated_at = ?2 WHERE uid = ?1",
        params![uid, now_utc()],
    )?;
    user_require(conn, uid)
}

/// Bootstrap: when no active admin exists, the frontend disables admin gating.
pub(crate) fn admin_exists(conn: &Connection) -> Result<bool, AppError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM users WHERE is_admin = 1 AND active = 1",
        [],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}
```

Command wrappers (same section as the others):

```rust
#[tauri::command]
pub fn upsert_guest(db: State<Db>, name: String, ssn: String) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_upsert_guest(&conn, name, ssn)
}

#[tauri::command]
pub fn promote_guest(db: State<Db>, uid: i64) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_promote_guest(&conn, uid)
}

#[tauri::command]
pub fn has_admin(db: State<Db>) -> Result<bool, AppError> {
    let conn = lock(&db)?;
    admin_exists(&conn)
}
```

- [ ] **Step 5: Expose user_is_guest on open loans and checkout log**

`src-tauri/src/checkout.rs` — `OpenCheckout` struct: add after `user_active`:

```rust
    pub user_is_guest: bool,
```

`list_open` SELECT: change `u.name, u.display_id, u.active,` to `u.name, u.display_id, u.active, u.is_guest,` and shift the mapper indices (u.is_guest is index 6; weapon fields and the rest shift by one). Full mapper after the change:

```rust
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
```

`src-tauri/src/logs.rs` — `CheckoutLog`: add `pub user_is_guest: bool,` after `user_active`. In the `query` SELECT append `, u.is_guest` at the END of the column list (index 17) and map `user_is_guest: r.get(17)?,` — appending avoids renumbering the existing 0–16 mapping.

- [ ] **Step 6: Register commands in lib.rs**

In `generate_handler!`, after `commands::set_preferred_weapon`:

```rust
            commands::upsert_guest,
            commands::promote_guest,
            commands::has_admin,
```

- [ ] **Step 7: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A src-tauri && git commit -m "feat(guests): upsert_guest/promote_guest/has_admin commands, is_guest on log views"
```

---

### Task 3: Weapon tags backend

**Files:**
- Modify: `src-tauri/src/commands.rs` (`weapon_set_tags` + wrapper + tests)
- Modify: `src-tauri/src/checkout.rs` (eval reports tags + tests)
- Modify: `src-tauri/src/lib.rs` (register)

**Interfaces:**
- Consumes: Task 1 tag columns.
- Produces: command `set_weapon_tags(weapon_uid, needs_service: bool, broken: bool, missing_parts: bool, needs_cleaning: bool, comment: Option<String>) -> Weapon`; `CheckoutEval { weapon_tags: Vec<String>, weapon_tag_comment: Option<String> }` where entries are the fixed keys `"needs_service" | "broken" | "missing_parts" | "needs_cleaning"` (frontend i18n key = `tag_` + entry).

- [ ] **Step 1: Failing tests**

In `commands.rs` tests:

```rust
    #[test]
    fn set_weapon_tags_round_trips_and_clears() {
        let conn = migrated_in_memory();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w = weapon_set_tags(&conn, w.uid, true, false, true, false, Some("kolv lös".into())).unwrap();
        assert!(w.tag_needs_service && w.tag_missing_parts);
        assert!(!w.tag_broken && !w.tag_needs_cleaning);
        assert_eq!(w.tag_comment.as_deref(), Some("kolv lös"));
        let w = weapon_set_tags(&conn, w.uid, false, false, false, false, None).unwrap();
        assert!(!w.tag_needs_service && !w.tag_missing_parts);
        assert_eq!(w.tag_comment, None);
        assert!(weapon_set_tags(&conn, 9999, false, false, false, false, None).is_err());
    }
```

In `checkout.rs` tests:

```rust
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` — compile error expected.

- [ ] **Step 3: Implement weapon_set_tags in commands.rs**

```rust
/// Set the fixed condition tags + free comment (current state, not history —
/// service history lives in weapon_service_log).
pub(crate) fn weapon_set_tags(
    conn: &Connection,
    uid: i64,
    needs_service: bool,
    broken: bool,
    missing_parts: bool,
    needs_cleaning: bool,
    comment: Option<String>,
) -> Result<Weapon, AppError> {
    weapon_require(conn, uid)?;
    conn.execute(
        "UPDATE weapons SET
           tag_needs_service = ?2, tag_broken = ?3, tag_missing_parts = ?4,
           tag_needs_cleaning = ?5, tag_comment = ?6, updated_at = ?7
         WHERE uid = ?1",
        params![uid, needs_service, broken, missing_parts, needs_cleaning, norm(comment), now_utc()],
    )?;
    weapon_require(conn, uid)
}
```

Wrapper:

```rust
#[tauri::command]
pub fn set_weapon_tags(
    db: State<Db>,
    weapon_uid: i64,
    needs_service: bool,
    broken: bool,
    missing_parts: bool,
    needs_cleaning: bool,
    comment: Option<String>,
) -> Result<Weapon, AppError> {
    let conn = lock(&db)?;
    weapon_set_tags(&conn, weapon_uid, needs_service, broken, missing_parts, needs_cleaning, comment)
}
```

Register `commands::set_weapon_tags,` in `lib.rs` `generate_handler!`.

- [ ] **Step 4: Eval reports tags in checkout.rs**

`CheckoutEval` (has `#[derive(Default)]`) — add:

```rust
    /// Active condition tags on the chosen weapon (fixed keys, e.g. "needs_service").
    /// Warn-only: tags never block checkout.
    pub weapon_tags: Vec<String>,
    pub weapon_tag_comment: Option<String>,
```

In `evaluate`, inside the existing `if let Some(w) = weapon_get(conn, wuid)?` block (before the inactive check is fine):

```rust
            if w.tag_needs_service { eval.weapon_tags.push("needs_service".into()); }
            if w.tag_broken { eval.weapon_tags.push("broken".into()); }
            if w.tag_missing_parts { eval.weapon_tags.push("missing_parts".into()); }
            if w.tag_needs_cleaning { eval.weapon_tags.push("needs_cleaning".into()); }
            eval.weapon_tag_comment = w.tag_comment.clone();
```

Note: `w.inactive_reason` is moved out of `w` later in that block — add the tag lines BEFORE any move of `w` fields, or clone as shown.

- [ ] **Step 5: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A src-tauri && git commit -m "feat(tags): set_weapon_tags command + eval reports active tags"
```

---

### Task 4: Frontend plumbing — api.ts, store, useIsAdmin, OperatorPicker

**Files:**
- Modify: `src/api.ts`
- Modify: `src/store.ts`
- Create: `src/useIsAdmin.ts`
- Modify: `src/OperatorPicker.tsx`
- Modify: `src/labels.ts`
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: Tasks 2–3 commands.
- Produces: `User { isGuest, isAdmin }`, `Weapon { tagNeedsService, tagBroken, tagMissingParts, tagNeedsCleaning, tagComment }`, `CheckoutEval { weaponTags: string[], weaponTagComment: string | null }`, `OpenCheckout { userIsGuest }`, `CheckoutLog { userIsGuest }`; wrappers `upsertGuest(name, ssn)`, `promoteGuest(uid)`, `hasAdmin()`, `setWeaponTags(weaponUid, tags: WeaponTags)`; `WEAPON_TAG_KEYS` const; `Operator { isAdmin: boolean }`; hook `useIsAdmin(): boolean`; `userLabel(name, displayId, active, t, isGuest?)`.

- [ ] **Step 1: api.ts types + wrappers**

Add to `User`: `isGuest: boolean; isAdmin: boolean;`. Add to `NewUser`: `isAdmin: boolean;` (UpdateUser extends NewUser — done). Add to `Weapon`: `tagNeedsService: boolean; tagBroken: boolean; tagMissingParts: boolean; tagNeedsCleaning: boolean; tagComment: string | null;`. Add to `CheckoutEval`: `weaponTags: string[]; weaponTagComment: string | null;`. Add to `OpenCheckout` and `CheckoutLog`: `userIsGuest: boolean;`.

New code (after the preferred-weapon wrapper):

```ts
// ---- Guests ----

export const upsertGuest = (name: string, ssn: string) =>
  invoke<User>('upsert_guest', { name, ssn });
export const promoteGuest = (uid: number) => invoke<User>('promote_guest', { uid });
export const hasAdmin = () => invoke<boolean>('has_admin');

// ---- Weapon tags ----

/** Fixed tag set; i18n label key = `tag_${key}`, weapon field = camelCase `tag${Key}`. */
export const WEAPON_TAG_KEYS = [
  'needs_service',
  'broken',
  'missing_parts',
  'needs_cleaning',
] as const;
export type WeaponTagKey = (typeof WEAPON_TAG_KEYS)[number];

export interface WeaponTags {
  needsService: boolean;
  broken: boolean;
  missingParts: boolean;
  needsCleaning: boolean;
  comment: string | null;
}

export const setWeaponTags = (weaponUid: number, tags: WeaponTags) =>
  invoke<Weapon>('set_weapon_tags', {
    weaponUid,
    needsService: tags.needsService,
    broken: tags.broken,
    missingParts: tags.missingParts,
    needsCleaning: tags.needsCleaning,
    comment: tags.comment,
  });

/** Active tag keys for a weapon row (weapons list / pickers / info modal). */
export const activeTagKeys = (w: Weapon): WeaponTagKey[] => {
  const out: WeaponTagKey[] = [];
  if (w.tagNeedsService) out.push('needs_service');
  if (w.tagBroken) out.push('broken');
  if (w.tagMissingParts) out.push('missing_parts');
  if (w.tagNeedsCleaning) out.push('needs_cleaning');
  return out;
};
```

- [ ] **Step 2: store.ts Operator gains isAdmin**

```ts
export interface Operator {
  uid: number;
  name: string;
  isAdmin: boolean;
}
```

No other store changes (persist already excludes `operator`).

- [ ] **Step 3: Create src/useIsAdmin.ts**

```ts
import { useQuery } from '@tanstack/react-query';
import { hasAdmin } from './api';
import { useAppStore } from './store';

/** UI-only admin gate. Bootstrap rule: while no active admin exists in the DB,
 *  gating is disabled (everything visible) so a blank install can create and
 *  flag its first admin. Backend commands are deliberately not gated. */
export function useIsAdmin(): boolean {
  const operator = useAppStore((s) => s.operator);
  const q = useQuery({ queryKey: ['hasAdmin'], queryFn: hasAdmin });
  if (q.data === false) return true; // bootstrap mode
  return operator?.isAdmin ?? false;
}
```

- [ ] **Step 4: OperatorPicker passes isAdmin**

In `confirm()`: `if (op) setOperator({ uid: op.uid, name: op.name, isAdmin: op.isAdmin });`

- [ ] **Step 5: labels.ts guest suffix**

`userLabel` gains an optional trailing param — existing call sites stay valid:

```ts
export function userLabel(
  name: string | null,
  displayId: string | null,
  active: boolean,
  t: TFunction,
  isGuest = false,
): string {
  const n = name ?? '';
  const guest = isGuest ? ` (${t('label_guest')})` : '';
  if (!active) return `${n}${guest} [${t('label_disabled')}]`;
  return displayId ? `${n}${guest} [${displayId}]` : `${n}${guest}`;
}
```

- [ ] **Step 6: i18n keys (both sv and en)**

Add to `src/i18n.ts` (sv / en):

```
label_guest: 'gäst' / 'guest'
err_ssn_required: 'Personnummer krävs för gäst.' / 'SSN is required for a guest.'
err_ssn_belongs_to_member: 'Personnumret tillhör medlemmen {{name}} — använd vanlig utlåning.' / 'The SSN belongs to member {{name}} — use a normal member checkout.'
err_not_a_guest: 'Användaren är inte en gäst.' / 'The user is not a guest.'
```

(Interpolation follows the existing `{{name}}` pattern used by other error keys in `src/errors.ts`.)

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: green (nothing consumes the new pieces yet except OperatorPicker).

- [ ] **Step 8: Commit**

```bash
git add src/api.ts src/store.ts src/useIsAdmin.ts src/OperatorPicker.tsx src/labels.ts src/i18n.ts
git commit -m "feat(front): guest/admin/tags API plumbing, Operator.isAdmin, useIsAdmin hook"
```

---

### Task 5: Page split — CheckinPage, slim CheckoutPage, nav badge

**Files:**
- Create: `src/CheckinPage.tsx`
- Modify: `src/CheckoutPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/AppLayout.tsx`
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: existing `listOpenCheckouts`, `doCheckin`, `setPreferredWeapon`, `outstandingDebts`, `IdNumpadModal`, `DebtModal`, info modals, `userLabel(..., isGuest)`.
- Produces: route `/checkin`; `CheckinPage` component; nav badge fed by the shared `['openCheckouts']` query.

- [ ] **Step 1: Create CheckinPage.tsx**

Move from `CheckoutPage.tsx` into the new page: the whole "Open checkouts / checkin" `Card` (list + fast-checkin button), the `open`/`debts`/`users` queries it needs, `checkinMut`, `favMut`, `preferrerOf`, `debtMap`, `matchCheckin`, `onFastCheckinSubmit`, `fastCheckinOpen`/`debtUser`/`infoMember`/`infoWeapon` state, and the `DebtModal`/`MemberInfoModal`/`WeaponInfoModal`/`IdNumpadModal` instances. Shape:

```tsx
export function CheckinPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);
  // ...moved state...

  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    refetchInterval: 30_000, // self-heal, see BACKLOG (stale open-loans)
  });
  // ...moved queries/mutations/helpers verbatim...

  return (
    <Card withBorder padding="lg">
      {/* moved open-loans card content; full-width now, so keep
          ScrollArea.Autosize mah="calc(100vh - 240px)" */}
    </Card>
  );
}
```

Layout: single full-width `Card` (the page is only this list). Keep row markup identical (touch-sized ActionIcons `size="lg"`), pass `o.userIsGuest` as the new fifth arg to every `userLabel(o.userName, o.userDisplayId, o.userActive, t, o.userIsGuest)` call. Keep all `qc.invalidateQueries` keys as they are.

- [ ] **Step 2: Slim CheckoutPage.tsx**

Delete everything moved in Step 1 (the second `Card`, its state/queries/mutations/modals; `checkinMut`, `favMut`, `preferrerOf`, `matchCheckin`, `onFastCheckinSubmit`, the `open` and `debts` queries, now-unused imports like `IconCoins`, `IconArrowBackUp`, `ScrollArea`, `IdNumpadModal`, `DebtModal`, `Tooltip`, `ActionIcon`). Keep: member/weapon picker flow, notes, eval, `checkoutMut`, `MemberPickerModal`, `WeaponPickerModal`, and the info modals ONLY if still referenced (they aren't after the move — remove them here). Replace the outer `SimpleGrid cols={{ base: 1, md: 2 }}` with a centered single card:

```tsx
  return (
    <Card withBorder padding="lg" maw={560} mx="auto">
      {/* existing "New checkout" Stack unchanged */}
    </Card>
  );
```

(`checkoutMut.onSuccess` keeps invalidating `['openCheckouts']` — the badge and CheckinPage consume it.)

- [ ] **Step 3: Route in App.tsx**

```tsx
import { CheckinPage } from './CheckinPage';
// inside <Route path="/" ...>
                <Route path="checkin" element={<CheckinPage />} />
```

- [ ] **Step 4: Nav item + badge in AppLayout.tsx**

`NAV` becomes:

```tsx
const NAV = [
  { to: '/checkout', key: 'nav_checkout' },
  { to: '/checkin', key: 'nav_checkin' },
  { to: '/members', key: 'nav_members' },
  { to: '/weapons', key: 'nav_weapons' },
  { to: '/logs', key: 'nav_logs' },
] as const;
```

Add the shared query inside `AppLayout` (imports: `listOpenCheckouts` from `./api`):

```tsx
  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    refetchInterval: 30_000,
  });
  const openCount = open.data?.length ?? 0;
```

Render the badge on the checkin button only:

```tsx
            {NAV.map((item) => (
              <Button
                key={item.to}
                component={NavLink}
                to={item.to}
                variant="subtle"
                size="md"
                rightSection={
                  item.to === '/checkin' && openCount > 0 ? (
                    <Badge size="lg" circle color="teal">
                      {openCount}
                    </Badge>
                  ) : undefined
                }
              >
                {t(item.key)}
              </Button>
            ))}
```

- [ ] **Step 5: i18n**

```
nav_checkin: 'Återlämning' / 'Check-in'
```

(Verify the existing `nav_checkout` sv copy and keep the pair consistent — e.g. if `nav_checkout` is 'Utlåning', 'Återlämning' pairs correctly.)

- [ ] **Step 6: Build + grep for orphans**

Run: `npm run build` — expected green.
Run: `grep -n "fastCheckin\|matchCheckin\|checkinMut\|favMut" src/CheckoutPage.tsx` — expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add src/CheckinPage.tsx src/CheckoutPage.tsx src/App.tsx src/AppLayout.tsx src/i18n.ts
git commit -m "feat(pages): split checkout/checkin into two pages, open-loan badge in nav"
```

---

### Task 6: TagModal + tag badges/filter/warning

**Files:**
- Create: `src/TagModal.tsx`
- Modify: `src/CheckinPage.tsx` (tag button per row)
- Modify: `src/WeaponsPage.tsx` (badges + filter chips + row action)
- Modify: `src/WeaponInfoModal.tsx` (tags display + edit button)
- Modify: `src/WeaponPickerModal.tsx` (row badges)
- Modify: `src/CheckoutPage.tsx` (warn on tagged weapon)
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: `setWeaponTags`, `activeTagKeys`, `WEAPON_TAG_KEYS`, `Weapon` tag fields, `CheckoutEval.weaponTags`.
- Produces: `<TagModal weaponUid={number | null} opened onClose />` (loads the weapon itself from the `['weapons']` cache/query; saves and invalidates `['weapons']` + `['eval']`).

- [ ] **Step 1: Create TagModal.tsx**

```tsx
import { Modal, Stack, Chip, Group, Textarea, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWeapons, setWeaponTags, activeTagKeys, WEAPON_TAG_KEYS, type WeaponTagKey } from './api';
import { errorMessage } from './errors';
import { weaponLabel } from './labels';

// Condition tags + free comment for one weapon. Operators may set and clear —
// no admin needed (technician workflow).
export function TagModal({
  weaponUid,
  opened,
  onClose,
}: {
  weaponUid: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled: opened });
  const weapon = (weapons.data ?? []).find((w) => w.uid === weaponUid);

  const [keys, setKeys] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  // Re-seed from the weapon each open (and when the row arrives async).
  useEffect(() => {
    if (opened && weapon) {
      setKeys(activeTagKeys(weapon));
      setComment(weapon.tagComment ?? '');
    }
  }, [opened, weapon?.uid, weapon?.updatedAt]);

  const save = useMutation({
    mutationFn: () =>
      setWeaponTags(weaponUid!, {
        needsService: keys.includes('needs_service'),
        broken: keys.includes('broken'),
        missingParts: keys.includes('missing_parts'),
        needsCleaning: keys.includes('needs_cleaning'),
        comment: comment.trim() || null,
      }),
    onSuccess: () => {
      notifications.show({ message: t('tags_saved_ok') });
      qc.invalidateQueries({ queryKey: ['weapons'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={
        weapon
          ? `${t('edit_tags')} — ${weaponLabel(weapon.brand, weapon.model, weapon.caliber, weapon.displayId, weapon.active, t)}`
          : t('edit_tags')
      }
    >
      <Stack>
        <Chip.Group multiple value={keys} onChange={setKeys}>
          <Group gap="xs">
            {WEAPON_TAG_KEYS.map((k: WeaponTagKey) => (
              <Chip key={k} value={k} size="lg" color="orange">
                {t(`tag_${k}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Textarea
          label={t('field_tag_comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autosize
          minRows={2}
        />
        <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {t('save')}
        </Button>
      </Stack>
    </Modal>
  );
}
```

(Check `t('save')` exists in i18n; if the codebase uses another key for save buttons, reuse that one.)

- [ ] **Step 2: Tag button on CheckinPage rows**

State: `const [tagWeapon, setTagWeapon] = useState<number | null>(null);`. In each open-loan row's action `Group`, before the debt button:

```tsx
                        <Tooltip label={t('edit_tags')}>
                          <ActionIcon
                            variant="subtle"
                            color="orange"
                            size="lg"
                            aria-label={t('edit_tags')}
                            onClick={() => setTagWeapon(o.weaponUid)}
                          >
                            <IconTag />
                          </ActionIcon>
                        </Tooltip>
```

(`import { IconTag } from '@tabler/icons-react';`.) Mount once per page:

```tsx
      <TagModal weaponUid={tagWeapon} opened={tagWeapon != null} onClose={() => setTagWeapon(null)} />
```

- [ ] **Step 3: WeaponsPage — badges, filter, row action**

CAUTION: this file contains 2 literal NUL bytes (~line 114); make targeted edits only.

- Per-row tag badges: in the weapon row (next to the name/label cell), render:

```tsx
                {activeTagKeys(w).map((k) => (
                  <Badge key={k} color="orange" variant="light" size="sm">
                    {t(`tag_${k}`)}
                  </Badge>
                ))}
```

- Filter chips above the table (next to the existing show-inactive Switch), any-of semantics:

```tsx
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // in the filter row:
  <Chip.Group multiple value={tagFilter} onChange={setTagFilter}>
    <Group gap="xs">
      {WEAPON_TAG_KEYS.map((k) => (
        <Chip key={k} value={k} size="sm" color="orange">{t(`tag_${k}`)}</Chip>
      ))}
    </Group>
  </Chip.Group>
```

  In the existing `filtered` computation add: `if (tagFilter.length > 0 && !activeTagKeys(w).some((k) => tagFilter.includes(k))) return false;`
- Row action: an `IconTag` ActionIcon per row opening the shared `TagModal` (same pattern as Step 2; do not require admin).

- [ ] **Step 4: WeaponInfoModal — show tags + comment + edit button**

In the info grid, add a tags row: orange badges via `activeTagKeys` on the loaded weapon + `tagComment` as dimmed text below, plus an `IconTag` button opening `TagModal` (nested modal is fine — Mantine stacks them; alternatively close info first — implementer's choice, simplest wins).

- [ ] **Step 5: WeaponPickerModal — row badges**

In each weapon row card, after the label, render the same orange `Badge` list via `activeTagKeys(w)`. Small (`size="xs"`), so rows stay compact.

- [ ] **Step 6: CheckoutPage — tagged-weapon warning**

Below `weaponError` (the red text), add a non-blocking orange warning from eval:

```tsx
  const weaponWarning: string | undefined =
    ev && ev.weaponTags.length > 0
      ? t('warning_weapon_tagged', {
          tags: ev.weaponTags.map((k) => t(`tag_${k}`)).join(', '),
        }) + (ev.weaponTagComment ? ` — ${ev.weaponTagComment}` : '')
      : undefined;
```

Render under the weapon field: `{weaponWarning && <Text fz="xs" c="orange">{weaponWarning}</Text>}`.

- [ ] **Step 7: i18n**

```
tag_needs_service: 'Behöver service' / 'Needs service'
tag_broken: 'Trasig' / 'Broken'
tag_missing_parts: 'Saknar delar' / 'Missing parts'
tag_needs_cleaning: 'Behöver rengöring' / 'Needs cleaning'
edit_tags: 'Taggar' / 'Tags'
field_tag_comment: 'Kommentar' / 'Comment'
tags_saved_ok: 'Taggar sparade' / 'Tags saved'
warning_weapon_tagged: 'Vapnet är markerat: {{tags}}' / 'Weapon is tagged: {{tags}}'
```

- [ ] **Step 8: Build**

Run: `npm run build` — expected green.

- [ ] **Step 9: Commit**

```bash
git add src/TagModal.tsx src/CheckinPage.tsx src/WeaponsPage.tsx src/WeaponInfoModal.tsx src/WeaponPickerModal.tsx src/CheckoutPage.tsx src/i18n.ts
git commit -m "feat(tags): TagModal, weapons-list filter/badges, picker badges, checkout warning"
```

---

### Task 7: Guest flow frontend

**Files:**
- Create: `src/GuestModal.tsx`
- Modify: `src/CheckoutPage.tsx` (guest button)
- Modify: `src/MemberPickerModal.tsx` (exclude guests)
- Modify: `src/MembersPage.tsx` (hide guests by default, show-guests toggle, promote)
- Modify: `src/LogsPage.tsx` + any other `userLabel` call sites that have guest data (pass `userIsGuest`)
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: `upsertGuest`, `promoteGuest`, `useIsAdmin`, `User.isGuest`, `CheckoutLog.userIsGuest`, `userLabel(..., isGuest)`.
- Produces: `<GuestModal opened onClose onSelect={(uid: number) => void} />`.

- [ ] **Step 1: Create GuestModal.tsx**

```tsx
import { Modal, Stack, TextInput, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upsertGuest } from './api';
import { errorMessage } from './errors';

// Guest checkout entry: SSN identifies the guest (unique); a repeat SSN reuses
// the existing guest row (name shown then comes from the DB, not this form).
export function GuestModal({
  opened,
  onClose,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [ssn, setSsn] = useState('');

  useEffect(() => {
    if (opened) {
      setName('');
      setSsn('');
    }
  }, [opened]);

  const mut = useMutation({
    mutationFn: () => upsertGuest(name, ssn),
    onSuccess: (u) => {
      onSelect(u.uid);
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Modal opened={opened} onClose={onClose} centered title={t('guest_checkout')}>
      <Stack>
        <TextInput
          label={t('field_ssn')}
          value={ssn}
          onChange={(e) => setSsn(e.target.value)}
          placeholder="ÅÅÅÅMMDD-XXXX"
          size="lg"
          data-autofocus
        />
        <TextInput
          label={t('field_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="lg"
        />
        <Button
          size="lg"
          disabled={!name.trim() || !ssn.trim()}
          loading={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {t('guest_continue')}
        </Button>
      </Stack>
    </Modal>
  );
}
```

(Reuse existing i18n keys `field_ssn`/`field_name` — grep `src/i18n.ts`; they exist for the member form. `onChange` uses `e.target` per project memory — NOT `e.currentTarget`.)

- [ ] **Step 2: Guest button on CheckoutPage**

State: `const [guestOpen, setGuestOpen] = useState(false);`. Next to the member picker button (inside the same `Group`, after the `Input.Wrapper`):

```tsx
              <Button variant="default" onClick={() => setGuestOpen(true)}>
                {t('guest_button')}
              </Button>
```

Mount:

```tsx
      <GuestModal
        opened={guestOpen}
        onClose={() => setGuestOpen(false)}
        onSelect={(uid) => onMemberChange(uid)}
      />
```

`onMemberChange` already sets user + autofills weapon; a fresh guest has no history so the weapon just clears. The member button then shows the guest via the existing `selectedUser` lookup — pass `selectedUser.isGuest` to that `userLabel` call (fifth arg).

- [ ] **Step 3: MemberPickerModal excludes guests**

`const pool = (users.data ?? []).filter((u) => u.active && !u.isGuest);`

- [ ] **Step 4: MembersPage — guests hidden, toggle, promote**

- Filter: in the existing `filtered` computation (~line 224) add `if (!showGuests && u.isGuest) return false;` with `const [showGuests, setShowGuests] = useState(false);`.
- Toggle next to the show-inactive Switch, rendered only for admins (`useIsAdmin()`):

```tsx
          {isAdmin && (
            <Switch label={t('show_guests')} checked={showGuests} onChange={(e) => setShowGuests(e.target.checked)} />
          )}
```

- Guest rows: `Badge color="cyan"` with `t('label_guest')` in the same cell that shows the staff badge; plus a Promote button in the row actions (admin only):

```tsx
                  {isAdmin && u.isGuest && (
                    <Button size="xs" variant="light" onClick={() => promoteMut.mutate(u.uid)}>
                      {t('promote_guest')}
                    </Button>
                  )}
```

```tsx
  const promoteMut = useMutation({
    mutationFn: (uid: number) => promoteGuest(uid),
    onSuccess: () => {
      notifications.show({ message: t('promoted_ok') });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
```

- The edit modal for a guest row: allowed for admins (it's just `update_user`); nothing special needed.

- [ ] **Step 5: Pass userIsGuest through remaining userLabel calls**

Grep: `grep -n "userLabel(" src/*.tsx`. For every call where the data row now carries `userIsGuest` (CheckinPage rows — done in Task 5, LogsPage rows, CheckoutPage matchless leftovers) add the fifth arg. Calls on plain `User` objects pass `u.isGuest`. Calls where guest status is unavailable (e.g. eval's open-holder fields) stay 4-arg — acceptable.

- [ ] **Step 6: i18n**

```
guest_button: 'Gäst' / 'Guest'
guest_checkout: 'Gästutlåning' / 'Guest checkout'
guest_continue: 'Fortsätt' / 'Continue'
show_guests: 'Visa gäster' / 'Show guests'
promote_guest: 'Gör till medlem' / 'Make member'
promoted_ok: 'Gästen är nu medlem' / 'Guest is now a member'
```

- [ ] **Step 7: Build**

Run: `npm run build` — expected green.

- [ ] **Step 8: Commit**

```bash
git add src/GuestModal.tsx src/CheckoutPage.tsx src/MemberPickerModal.tsx src/MembersPage.tsx src/LogsPage.tsx src/i18n.ts
git commit -m "feat(guests): guest checkout modal, member-list separation, admin promote"
```

---

### Task 8: Admin gating UI

**Files:**
- Modify: `src/MembersPage.tsx` (new/edit buttons, admin checkbox in form, hasAdmin invalidation)
- Modify: `src/WeaponsPage.tsx` (new/edit buttons)
- Modify: `src/AppLayout.tsx` (settings gear)
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: `useIsAdmin()`, `NewUser.isAdmin`.
- Produces: admin-only visibility for entity CRUD + settings; admin checkbox on the member form.

- [ ] **Step 1: MembersPage**

- `const isAdmin = useIsAdmin();` (already imported in Task 7).
- Hide for non-admin: the `t('new_member')` button (~line 324), the per-row edit button, and the activate/deactivate button (wrap each in `{isAdmin && ...}`). Row click → info modal stays for everyone.
- Member form (`useForm<MemberForm>` ~line 108): add `isAdmin: boolean` to the form type/initialValues/edit-prefill/submit payload (`createUser`/`updateUser` input now carries `isAdmin`). Render, next to the existing staff Checkbox, visible only when the current operator is admin:

```tsx
            {isAdmin && (
              <Checkbox label={t('field_admin')} {...form.getInputProps('isAdmin', { type: 'checkbox' })} />
            )}
```

- On every user mutation `onSuccess` in this page (create/update/setActive), add `qc.invalidateQueries({ queryKey: ['hasAdmin'] });` — flagging/unflagging or deactivating an admin must update the bootstrap gate immediately.

- [ ] **Step 2: WeaponsPage**

`const isAdmin = useIsAdmin();` — hide the new-weapon button, per-row edit and activate/deactivate buttons for non-admins (`{isAdmin && ...}`). The tag button from Task 6 stays visible to everyone.

- [ ] **Step 3: AppLayout settings gear**

`const isAdmin = useIsAdmin();` in `AppLayout`; wrap the settings `ActionIcon` (⚙) in `{isAdmin && ...}`.

- [ ] **Step 4: i18n**

```
field_admin: 'Administratör' / 'Administrator'
```

- [ ] **Step 5: Build + bootstrap sanity check**

Run: `npm run build` — expected green.
Reasoning check (no code): fresh DB → `has_admin` = false → `useIsAdmin()` = true for everyone → OperatorPicker's existing empty-state escape ("add first operator" → Members) works, buttons visible, first user can be created with staff+admin checked. Confirm nothing in the new gating blocks that path.

- [ ] **Step 6: Commit**

```bash
git add src/MembersPage.tsx src/WeaponsPage.tsx src/AppLayout.tsx src/i18n.ts
git commit -m "feat(admin): hide entity CRUD + settings behind is_admin, admin checkbox on member form"
```

---

### Task 9: Seed data + docs sync

**Files:**
- Modify: `src-tauri/src/seed.rs`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `user_upsert_guest`, `weapon_set_tags`, `NewUser.is_admin`, `do_checkout`.

- [ ] **Step 1: Extend seed.rs**

- Make the first seeded operator an admin: at the operator-creation site set `is_admin: true` for exactly one operator (the first), rest `false`.
- After users/weapons are created, add two guests (import `user_upsert_guest`, `weapon_set_tags` from commands):

```rust
    // Guests: one repeat visitor with an open loan, one without history.
    let g1 = user_upsert_guest(conn, "Gustav Gästsson".into(), "19870707-7777".into())?.uid;
    user_upsert_guest(conn, "Greta Gästberg".into(), "19920202-2222".into())?;
```

  Give `g1` an OPEN checkout via the existing open-loan pattern (`do_checkout(conn, <free weapon uid>, g1, <op uid>, opt("Gästlån"))` with no matching `do_checkin`) — pick a weapon uid not already used by the existing open-loan block so `do_checkout` doesn't reject a second open row.
- Tag three weapons (uids from the created list):

```rust
    weapon_set_tags(conn, w_a, true, false, false, false, Some("Kolven glappar".into()))?;
    weapon_set_tags(conn, w_b, false, true, true, false, None)?;
    weapon_set_tags(conn, w_c, false, false, false, true, None)?;
```

- Update the seed test `seeds_expected_counts_and_is_idempotent` if it asserts user counts (guests add 2).

- [ ] **Step 2: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` — expected green (seed tests included).

- [ ] **Step 3: Sync CLAUDE.md**

- Migrations note: "Currently 3 migrations (0001–0003)" → 4 (0001–0004), mention `SCHEMA_V4` (is_guest/is_admin/tag columns).
- Identity model: add one line — guests are users rows with `is_guest`, SSN-unique among active users (app-enforced), created via `upsert_guest`, promoted via `promote_guest` (admin-only UI).
- File map: add `CheckinPage.tsx`, `GuestModal.tsx`, `TagModal.tsx`, `useIsAdmin.ts`; note CheckoutPage no longer hosts the open-loans list.
- Status: append this wave (pending live-smoke).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/seed.rs CLAUDE.md
git commit -m "chore(seed,docs): seed guests/tags/admin operator, sync CLAUDE.md"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full green check**

```bash
npm run build && cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both green, zero warnings introduced (`cargo test` output clean of new warnings).

- [ ] **Step 2: Orphan sweep**

```bash
grep -rn "openCheckouts" src/ | grep -v CheckinPage | grep -v AppLayout | grep -v CheckoutPage
npx tsc --noEmit
```

Confirm no dead imports/exports from the page split (build already type-checks; this is belt-and-braces).

- [ ] **Step 3: User live-smoke in `npm run tauri dev`** (user does this; every milestone has had live-only bugs)

Checklist for the user: page split nav + badge count; fast checkin from CheckinPage; guest checkout end-to-end + repeat guest (same SSN) + member-SSN conflict error; tag set/clear from checkin row + weapons-list filter + picker badge + checkout warning; admin vs non-admin operator (buttons hidden, settings gear hidden); guest promote as admin; fresh-DB bootstrap (temporarily move the dev DB aside, verify first-user flow, restore).

- [ ] **Step 4: Merge** (after user approves smoke) — merge `feat/checkin-guest-tags-admin` to `main`, delete branch.
