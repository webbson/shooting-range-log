# Picker Modals + Preferred Weapon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the checkout page's member/weapon dropdowns with touch-first filterable picker modals, and add an exclusive per-member "preferred weapon" that auto-fills at checkout and can be set from the return list and the member edit form.

**Architecture:** Backend first: migration 0003 adds `users.preferred_weapon_uid` (partial unique index enforces one member per weapon), a `set_preferred_weapon` command, and preference-aware suggestion in `evaluate_checkout`. Frontend: a shared `Numpad` extracted from `IdNumpadModal`, two self-contained picker modals (`WeaponPickerModal`, `MemberPickerModal`), checkout page rewired to button-inputs + pickers, star button in the return list, preferred-weapon field in member edit/detail.

**Tech Stack:** Tauri 2 (Rust, rusqlite, rusqlite_migration) · React + TypeScript + Mantine v9 · TanStack Query · react-i18next (sv default + en).

**Spec:** `docs/superpowers/specs/2026-07-14-picker-modals-preferred-weapon-design.md`
**Branch:** `feat/picker-modals-preferred-weapon` (already created; spec committed).

## Global Constraints

- Migrations 0001/0002 have shipped — NEVER edit them. Append 0003 to the `migrations()` vec in `src-tauri/src/db.rs`.
- All DB access through Rust `#[tauri::command]`s; validation/business rules in Rust, not JS.
- Every new command registered in `lib.rs` `generate_handler![]`.
- Errors: `AppError { code, message, params }` via constructor helpers; frontend translates via `errorMessage(e, t)`.
- All user-facing strings added to BOTH `sv` and `en` objects in `src/i18n.ts` (flat keys, `{{param}}` interpolation). Never hardcode UI copy.
- Tauri v2 args: JS camelCase → Rust snake_case (automatic).
- Frontend data via TanStack Query; mutations `invalidateQueries` on success; errors via Mantine `notifications` + `errorMessage`.
- In React `onChange` handlers use `e.target`, NOT `e.currentTarget` (has crashed this app twice). Don't touch existing `e.currentTarget` usages.
- No new npm dependencies — no icon library; use text `★`/`☆`/`▾` glyphs (matches existing `⌨` button).
- Backend test command: `cargo test --manifest-path src-tauri/Cargo.toml` (run from repo root). Frontend check: `npm run build`. Both green before any task is "done". There is no frontend unit-test framework — frontend verification is typecheck/build + user live-smoke at the end.
- Commit after each task on the feature branch.

---

### Task 1: Migration 0003 + `preferred_weapon_uid` on the User model

**Files:**
- Modify: `src-tauri/src/db.rs` (schema consts ~line 108-128, test ~line 183-191)
- Modify: `src-tauri/src/models.rs` (USER_COLS line 10-11, User struct line 15-49)
- Test: inline `#[cfg(test)]` in `src-tauri/src/commands.rs` + existing test in `db.rs`

**Interfaces:**
- Consumes: existing `migrations()` vec, `User`/`USER_COLS`.
- Produces: `users.preferred_weapon_uid` column + `idx_users_preferred_weapon` unique partial index; `User.preferred_weapon_uid: Option<i64>` (serializes as `preferredWeaponUid`). All later tasks rely on this field name.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/db.rs`, update the existing migration-count test (it will fail until 0003 exists):

```rust
    #[test]
    fn migrations_apply_to_in_memory_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3, "three migrations applied");
    }
```

In `src-tauri/src/commands.rs` tests module, add:

```rust
    #[test]
    fn user_has_no_preferred_weapon_by_default() {
        let conn = migrated_in_memory();
        let u = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        assert_eq!(u.preferred_weapon_uid, None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — `user_has_no_preferred_weapon_by_default` fails to compile (`no field preferred_weapon_uid`); once the field exists, `migrations_apply_to_in_memory_db` asserts 3 vs actual 2. A compile error counts as the failing state here.

- [ ] **Step 3: Add migration 0003 in `db.rs`**

After the `SCHEMA_V2` const (line ~116), add:

```rust
/// Preferred weapon per member (migration 0003). Single column = one preferred
/// weapon per member; the partial unique index = a weapon can be the preferred
/// weapon of at most one member.
const SCHEMA_V3: &str = r#"
ALTER TABLE users ADD COLUMN preferred_weapon_uid INTEGER REFERENCES weapons(uid);
CREATE UNIQUE INDEX idx_users_preferred_weapon
  ON users(preferred_weapon_uid) WHERE preferred_weapon_uid IS NOT NULL;
"#;
```

In `migrations()`, append to the vec:

```rust
        // 0003 — preferred weapon per member.
        M::up(SCHEMA_V3),
```

- [ ] **Step 4: Extend the User model in `models.rs`**

Replace `USER_COLS`:

```rust
pub const USER_COLS: &str =
    "uid, display_id, name, email, phone, address, ssn, is_staff, active, notes, preferred_weapon_uid, created_at, updated_at";
```

In `struct User`, after `pub notes: Option<String>,` add:

```rust
    pub preferred_weapon_uid: Option<i64>,
```

In `User::from_row`, after the `notes` line add:

```rust
            preferred_weapon_uid: row.get("preferred_weapon_uid")?,
```

Do NOT touch `NewUser`/`UpdateUser` — preference is set by its own command (Task 2), never through create/update.

- [ ] **Step 5: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all — including `migrations_validate`, seed tests, and the two new/updated tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/models.rs src-tauri/src/commands.rs
git commit -m "feat(db): migration 0003 — preferred_weapon_uid on users, exclusive per weapon"
```

---

### Task 2: `set_preferred_weapon` command + error code

**Files:**
- Modify: `src-tauri/src/error.rs` (add helper after `service_description_required`, ~line 144)
- Modify: `src-tauri/src/commands.rs` (inner fn after `user_set_active` ~line 189; wrapper after `set_user_active` ~line 369; tests)
- Modify: `src-tauri/src/lib.rs` (`generate_handler![]`, line ~273)

**Interfaces:**
- Consumes: `user_require`, `weapon_require`, `now_utc`, `AppError` (all already in `commands.rs`/`error.rs`); `User.preferred_weapon_uid` from Task 1.
- Produces: `pub(crate) fn user_set_preferred_weapon(conn: &Connection, user_uid: i64, weapon_uid: Option<i64>) -> Result<User, AppError>` (used by Task 3 tests + Task 8 seed) and Tauri command `set_preferred_weapon(user_uid, weapon_uid)` → `User` (invoked from JS as `set_preferred_weapon` with `{ userUid, weaponUid }`). Error code `err_weapon_already_preferred` with param `name`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/commands.rs` tests module, add:

```rust
    #[test]
    fn preferred_weapon_set_replace_clear() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let w1 = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        let w2 = weapon_create(&conn, new_weapon(Some("W2"), Some("S-2"))).unwrap();

        let a = user_set_preferred_weapon(&conn, a.uid, Some(w1.uid)).unwrap();
        assert_eq!(a.preferred_weapon_uid, Some(w1.uid));
        // Replacing the member's own preference is allowed.
        let a = user_set_preferred_weapon(&conn, a.uid, Some(w2.uid)).unwrap();
        assert_eq!(a.preferred_weapon_uid, Some(w2.uid));
        // Clearing.
        let a = user_set_preferred_weapon(&conn, a.uid, None).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
    }

    #[test]
    fn preferred_weapon_exclusive_per_weapon() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let b = user_create(&conn, new_user("Björn", Some("11"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();

        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        // Re-setting the same weapon for the same member is idempotent, not an error.
        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        // Another member wanting the same weapon is rejected, naming Anna.
        let err = user_set_preferred_weapon(&conn, b.uid, Some(w.uid)).unwrap_err();
        assert_eq!(err.code, "err_weapon_already_preferred");
        assert!(err.to_string().contains("Anna"), "{err}");
    }

    #[test]
    fn preferred_weapon_rejects_inactive_and_missing() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();
        weapon_set_active(&conn, w.uid, false, None, false).unwrap();

        let err = user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap_err();
        assert_eq!(err.code, "err_weapon_inactive");
        let err = user_set_preferred_weapon(&conn, a.uid, Some(9999)).unwrap_err();
        assert_eq!(err.code, "err_weapon_not_found");
        let err = user_set_preferred_weapon(&conn, 9999, None).unwrap_err();
        assert_eq!(err.code, "err_user_not_found");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml preferred_weapon`
Expected: FAIL to compile — `user_set_preferred_weapon` not found.

- [ ] **Step 3: Add the error helper in `error.rs`**

After `service_description_required()` (line ~144), add:

```rust
    pub fn weapon_already_preferred(name: &str) -> Self {
        AppError::new(
            "err_weapon_already_preferred",
            format!("Weapon is already the preferred weapon of {name}."),
            json!({ "name": name }),
        )
    }
```

- [ ] **Step 4: Add the inner fn + command wrapper in `commands.rs`**

After `user_set_active` (line ~189), add:

```rust
/// Set (or clear, with None) a member's preferred weapon. A weapon can be the
/// preferred weapon of at most one member — checked here first so the error can
/// name the competing member; the partial unique index is the DB backstop.
pub(crate) fn user_set_preferred_weapon(
    conn: &Connection,
    user_uid: i64,
    weapon_uid: Option<i64>,
) -> Result<User, AppError> {
    user_require(conn, user_uid)?;
    if let Some(wuid) = weapon_uid {
        let w = weapon_require(conn, wuid)?;
        if !w.active {
            return Err(AppError::weapon_inactive());
        }
        let other: Option<String> = conn
            .query_row(
                "SELECT name FROM users WHERE preferred_weapon_uid = ?1 AND uid <> ?2",
                params![wuid, user_uid],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(name) = other {
            return Err(AppError::weapon_already_preferred(&name));
        }
    }
    conn.execute(
        "UPDATE users SET preferred_weapon_uid = ?2, updated_at = ?3 WHERE uid = ?1",
        params![user_uid, weapon_uid, now_utc()],
    )?;
    user_require(conn, user_uid)
}
```

In the command-wrappers section, after `set_user_active` (line ~369), add:

```rust
#[tauri::command]
pub fn set_preferred_weapon(
    db: State<Db>,
    user_uid: i64,
    weapon_uid: Option<i64>,
) -> Result<User, AppError> {
    let conn = lock(&db)?;
    user_set_preferred_weapon(&conn, user_uid, weapon_uid)
}
```

- [ ] **Step 5: Register in `lib.rs`**

In `generate_handler![]`, after `commands::set_user_active,` (line ~273), add:

```rust
            commands::set_preferred_weapon,
```

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(members): set_preferred_weapon command, exclusive per weapon"
```

---

### Task 3: Preference-aware suggestion + `last_weapon_uid` in `evaluate_checkout`

**Files:**
- Modify: `src-tauri/src/checkout.rs` (CheckoutEval struct ~line 78-114; `evaluate` member→weapon block line ~256-273; tests)

**Interfaces:**
- Consumes: `user_set_preferred_weapon` (Task 2), `User.preferred_weapon_uid` (Task 1), existing `most_recent_weapon_uid_for_user`, `weapon_get`, `open_checkout_for`.
- Produces: `CheckoutEval.last_weapon_uid: Option<i64>` (serializes `lastWeaponUid` — Task 4/6 rely on it); `suggested_weapon_*` now = preferred (when active + not out) else most-recent. Semantics of all other eval fields unchanged.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/checkout.rs` tests module: extend the imports line to include `user_set_preferred_weapon`:

```rust
    use crate::commands::{
        user_create, user_set_active, user_set_preferred_weapon, weapon_create, weapon_set_active,
    };
```

Add tests:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib checkout`
Expected: FAIL to compile — `last_weapon_uid` field missing.

- [ ] **Step 3: Add the field to `CheckoutEval`**

After `pub suggested_weapon_out: bool,` (line ~98), add:

```rust
    /// Member's most recent weapon uid — pinned as "last" in the weapon picker,
    /// independent of which weapon the suggestion picked.
    pub last_weapon_uid: Option<i64>,
```

- [ ] **Step 4: Rework the member→weapon suggestion block in `evaluate`**

Replace the whole `if weapon_uid.is_none() { ... }` block (lines ~256-273) with:

```rust
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
```

- [ ] **Step 5: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — including the pre-existing `member_to_weapon_suggestion` test (same behavior when no preference is set).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/checkout.rs
git commit -m "feat(checkout): eval suggests preferred weapon first, exposes last_weapon_uid"
```

---

### Task 4: Frontend API surface + error i18n

**Files:**
- Modify: `src/api.ts` (User interface line 8-21; CheckoutEval line 92-120; new wrapper near `setUserActive` line 73-74)
- Modify: `src/i18n.ts` (both `sv` and `en` translation objects, next to the other `err_*` keys)

**Interfaces:**
- Consumes: Tauri commands from Tasks 1-3.
- Produces: `User.preferredWeaponUid: number | null`; `CheckoutEval.lastWeaponUid: number | null`; `setPreferredWeapon(userUid: number, weaponUid: number | null): Promise<User>`. i18n key `err_weapon_already_preferred`. Tasks 6-9 import these exact names.

- [ ] **Step 1: Extend `src/api.ts`**

In `interface User`, after `notes: string | null;` add:

```ts
  preferredWeaponUid: number | null;
```

In `interface CheckoutEval`, after `suggestedWeaponOut: boolean;` add:

```ts
  lastWeaponUid: number | null;
```

After the `setUserActive` wrapper (line ~74), add:

```ts
export const setPreferredWeapon = (userUid: number, weaponUid: number | null) =>
  invoke<User>('set_preferred_weapon', { userUid, weaponUid });
```

- [ ] **Step 2: Add the error string to `src/i18n.ts`**

In the `sv` translation object, next to the other `err_*` keys (~line 90-100):

```ts
    err_weapon_already_preferred: 'Vapnet är redan favoritvapen för {{name}}.',
```

In the `en` translation object, next to its `err_*` keys (~line 315-325):

```ts
    err_weapon_already_preferred: 'Weapon is already the preferred weapon of {{name}}.',
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (tsc + vite green).

- [ ] **Step 4: Commit**

```bash
git add src/api.ts src/i18n.ts
git commit -m "feat(api): preferredWeaponUid, lastWeaponUid, setPreferredWeapon wrapper"
```

---

### Task 5: Extract shared `Numpad` component

**Files:**
- Create: `src/Numpad.tsx`
- Modify: `src/IdNumpadModal.tsx`

**Interfaces:**
- Consumes: Mantine core, i18n key `enter_id` (exists).
- Produces: `Numpad({ value: string; onChange: (v: string) => void; size?: 'md' | 'xl' })` — readonly value display + 12-key grid. Task 6 embeds it at `size="md"`; `IdNumpadModal` keeps `size="xl"` (default). Fast check-in behavior unchanged.

- [ ] **Step 1: Create `src/Numpad.tsx`**

```tsx
import { SimpleGrid, Button, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Touch-first numeric keypad + readonly value display. Shared by the fast
// check-in modal (xl) and the picker modals (md). Keyboard entry stays the
// parent's job (it owns the value).
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

export function Numpad({
  value,
  onChange,
  size = 'xl',
}: {
  value: string;
  onChange: (v: string) => void;
  size?: 'md' | 'xl';
}) {
  const { t } = useTranslation();
  const press = (k: string) => {
    if (k === 'C') onChange('');
    else if (k === '⌫') onChange(value.slice(0, -1));
    else onChange(value + k);
  };
  return (
    <>
      <TextInput
        value={value}
        readOnly
        placeholder={t('enter_id')}
        size={size}
        styles={{
          input: {
            textAlign: 'center',
            fontSize: size === 'xl' ? '2rem' : '1.4rem',
            fontVariantNumeric: 'tabular-nums',
          },
        }}
      />
      <SimpleGrid cols={3} spacing="xs">
        {KEYS.map((k) => (
          <Button key={k} variant="default" size={size} onClick={() => press(k)}>
            {k}
          </Button>
        ))}
      </SimpleGrid>
    </>
  );
}
```

- [ ] **Step 2: Refactor `src/IdNumpadModal.tsx` to use it**

Replace the file's imports and body so the inline `TextInput` + `keys`/`press` + `SimpleGrid` are replaced by `<Numpad>`; everything else (match preview, submit, keyboard handler) stays identical:

```tsx
import { Modal, Stack, Button, Text, Paper } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Numpad } from './Numpad';

// Touch-first number pad for entering an entity tag (display_id) at checkout — a
// fast alternative to the searchable dropdown. Resolution lives in the parent
// (it knows the available pools): `match` returns the matched entity's label (or
// richer ReactNode) for the current entry (or null), shown live; confirm is
// enabled only on a match.
export function IdNumpadModal({
  opened,
  title,
  match,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  match: (id: string) => React.ReactNode | null;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  // Start empty each time the modal opens.
  useEffect(() => {
    if (opened) setValue('');
  }, [opened]);

  const matched = value ? match(value) : null;

  const submit = () => {
    if (matched) onSubmit(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') setValue((v) => v + e.key);
    else if (e.key === 'Backspace') setValue((v) => v.slice(0, -1));
    else if (e.key === 'Enter') submit();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="xs">
      <Stack onKeyDown={onKeyDown}>
        <Numpad value={value} onChange={setValue} />
        <Paper withBorder p="xs" ta="center">
          {matched ? (
            <Text fw={600} c="teal">
              {matched}
            </Text>
          ) : (
            <Text c="dimmed">{value ? t('no_match') : ' '}</Text>
          )}
        </Paper>
        <Button size="lg" fullWidth disabled={!matched} onClick={submit}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </Stack>
    </Modal>
  );
}
```

Note the layout change: value display + keypad now render together (above the match preview) instead of sandwiching it — acceptable; behavior identical.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/Numpad.tsx src/IdNumpadModal.tsx
git commit -m "refactor(ui): extract shared Numpad from IdNumpadModal"
```

---

### Task 6: `WeaponPickerModal` + `MemberPickerModal`

**Files:**
- Create: `src/WeaponPickerModal.tsx`
- Create: `src/MemberPickerModal.tsx`
- Modify: `src/i18n.ts` (new keys, both languages)

**Interfaces:**
- Consumes: `listWeapons`, `listUsers`, `listOpenCheckouts`, `Weapon`, `User` from `./api`; `weaponLabel`, `userLabel` from `./labels`; `Numpad` (Task 5).
- Produces:
  - `WeaponPickerModal({ opened, onClose, onSelect, pinned?, availableOnly? })` where `onSelect: (uid: number) => void`, `pinned?: { preferredUid?: number | null; lastUid?: number | null }`, `availableOnly?: boolean` (default false = all active weapons).
  - `MemberPickerModal({ opened, onClose, onSelect })`, `onSelect: (uid: number) => void`.
  - Tasks 7 and 9 mount these with exactly these props.

- [ ] **Step 1: Add i18n keys**

`sv` object:

```ts
    pick_weapon: 'Välj vapen',
    pick_member: 'Välj medlem',
    filter_text_weapon: 'Sök märke, modell, serienummer',
    filter_name: 'Sök namn',
    filter_brand: 'Märke',
    filter_caliber: 'Kaliber',
    badge_preferred: 'Favorit',
    badge_last: 'Senast',
    clear_selection: 'Rensa',
```

`en` object:

```ts
    pick_weapon: 'Select weapon',
    pick_member: 'Select member',
    filter_text_weapon: 'Search brand, model, serial',
    filter_name: 'Search name',
    filter_brand: 'Brand',
    filter_caliber: 'Caliber',
    badge_preferred: 'Favorite',
    badge_last: 'Last used',
    clear_selection: 'Clear',
```

(`no_results` already exists — reused.)

- [ ] **Step 2: Create `src/WeaponPickerModal.tsx`**

```tsx
import {
  Modal,
  Grid,
  Stack,
  Group,
  ScrollArea,
  Card,
  Text,
  Badge,
  TextInput,
  Select,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWeapons, listOpenCheckouts, type Weapon } from './api';
import { weaponLabel } from './labels';
import { Numpad } from './Numpad';

// Touch-first weapon selector: box list left, tag numpad + filters right.
// `pinned` floats the member's preferred / last-used weapon to the top with
// badges. `availableOnly` restricts to active weapons not currently out
// (checkout); otherwise all active weapons (member edit).
export function WeaponPickerModal({
  opened,
  onClose,
  onSelect,
  pinned,
  availableOnly = false,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
  pinned?: { preferredUid?: number | null; lastUid?: number | null };
  availableOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [caliber, setCaliber] = useState<string | null>(null);

  // Fresh filters each time the modal opens.
  useEffect(() => {
    if (opened) {
      setTag('');
      setText('');
      setBrand(null);
      setCaliber(null);
    }
  }, [opened]);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled: opened });
  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    enabled: opened && availableOnly,
  });
  const outSet = new Set((open.data ?? []).map((o) => o.weaponUid));

  const pool = (weapons.data ?? []).filter(
    (w) => w.active && (!availableOnly || !outSet.has(w.uid)),
  );

  // Filter option values from the visible pool, not the whole table.
  const brands = [...new Set(pool.map((w) => w.brand).filter(Boolean) as string[])].sort();
  const calibers = [...new Set(pool.map((w) => w.caliber).filter(Boolean) as string[])].sort();

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((w) => {
    if (tag && !(w.displayId ?? '').startsWith(tag)) return false;
    if (brand && w.brand !== brand) return false;
    if (caliber && w.caliber !== caliber) return false;
    if (q && ![w.brand, w.model, w.serial].some((f) => f?.toLowerCase().includes(q)))
      return false;
    return true;
  });

  const label = (w: Weapon) => weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t);
  const rank = (w: Weapon) =>
    w.uid === pinned?.preferredUid ? 0 : w.uid === pinned?.lastUid ? 1 : 2;
  const sorted = [...filtered].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return label(a).localeCompare(label(b), 'sv');
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t('pick_weapon')} size="xl" centered>
      <Grid gutter="md">
        <Grid.Col span={7}>
          <ScrollArea h={420} type="auto">
            <Stack gap="xs">
              {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
              {sorted.map((w) => (
                <Card
                  key={w.uid}
                  withBorder
                  padding="sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(w.uid)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{label(w)}</Text>
                      {w.serial && (
                        <Text size="xs" c="dimmed">
                          {w.serial}
                        </Text>
                      )}
                    </Stack>
                    {w.uid === pinned?.preferredUid ? (
                      <Badge color="yellow" variant="light">
                        ★ {t('badge_preferred')}
                      </Badge>
                    ) : w.uid === pinned?.lastUid ? (
                      <Badge color="gray" variant="light">
                        {t('badge_last')}
                      </Badge>
                    ) : null}
                  </Group>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={5}>
          <Stack gap="xs">
            <Numpad value={tag} onChange={setTag} size="md" />
            <TextInput
              placeholder={t('filter_text_weapon')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Select
              placeholder={t('filter_brand')}
              data={brands}
              value={brand}
              onChange={setBrand}
              clearable
              searchable
            />
            <Select
              placeholder={t('filter_caliber')}
              data={calibers}
              value={caliber}
              onChange={setCaliber}
              clearable
              searchable
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
```

- [ ] **Step 3: Create `src/MemberPickerModal.tsx`**

```tsx
import {
  Modal,
  Grid,
  Stack,
  ScrollArea,
  Card,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listUsers } from './api';
import { userLabel } from './labels';
import { Numpad } from './Numpad';

// Touch-first member selector: box list left, tag numpad + name search right.
// Active members only (same pool as the old dropdown).
export function MemberPickerModal({
  opened,
  onClose,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
}) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (opened) {
      setTag('');
      setText('');
    }
  }, [opened]);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const pool = (users.data ?? []).filter((u) => u.active);

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((u) => {
    if (tag && !(u.displayId ?? '').startsWith(tag)) return false;
    if (q && !u.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  return (
    <Modal opened={opened} onClose={onClose} title={t('pick_member')} size="xl" centered>
      <Grid gutter="md">
        <Grid.Col span={7}>
          <ScrollArea h={420} type="auto">
            <Stack gap="xs">
              {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
              {sorted.map((u) => (
                <Card
                  key={u.uid}
                  withBorder
                  padding="sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(u.uid)}
                >
                  <Stack gap={2}>
                    <Text fw={600}>{userLabel(u.name, u.displayId, true, t)}</Text>
                    {u.phone && (
                      <Text size="xs" c="dimmed">
                        {u.phone}
                      </Text>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={5}>
          <Stack gap="xs">
            <Numpad value={tag} onChange={setTag} size="md" />
            <TextInput
              placeholder={t('filter_name')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS (components compile even though nothing mounts them yet).

- [ ] **Step 5: Commit**

```bash
git add src/WeaponPickerModal.tsx src/MemberPickerModal.tsx src/i18n.ts
git commit -m "feat(ui): WeaponPickerModal + MemberPickerModal (filterable, numpad, pinning)"
```

---

### Task 7: Rewire the checkout page to the pickers

**Files:**
- Modify: `src/CheckoutPage.tsx`

**Interfaces:**
- Consumes: `WeaponPickerModal`, `MemberPickerModal` (Task 6), `CheckoutEval.lastWeaponUid` + `User.preferredWeaponUid` (Task 4).
- Produces: checkout member/weapon selection via modals; `onMemberChange`/`onWeaponChange` now take `number | null`. Fast check-in untouched. Return-list star lands in Task 8 (separate concern, same file).

- [ ] **Step 1: Rework selection state + handlers**

In `src/CheckoutPage.tsx`:

Replace the `numpad` state (line ~43) with:

```tsx
  // Which picker modal is open (replaces the old per-field numpad entry).
  const [picker, setPicker] = useState<'weapon' | 'member' | null>(null);
```

Change the two handlers to take uids directly (the `Select`s and their string values are gone). Note `onMemberChange` now also respects `suggestedWeaponOut` — the backend has always flagged it and the header comment ("we skip autofill when the suggested counterpart is unavailable") promised it; the old string handler ignored the flag:

```tsx
  const onWeaponChange = async (wid: number | null) => {
    setWeaponUid(wid);
    if (wid != null && userUid == null) {
      const e = await evaluateCheckout(wid, null);
      if (e.suggestedUserUid != null && !e.suggestedUserBusy) setUserUid(e.suggestedUserUid);
    }
  };

  const onMemberChange = async (uid: number | null) => {
    setUserUid(uid);
    if (uid != null) {
      const e = await evaluateCheckout(null, uid);
      if (e.suggestedWeaponUid != null && !e.suggestedWeaponOut)
        setWeaponUid(e.suggestedWeaponUid);
    }
  };
```

Delete: the `weaponData`/`userData` arrays (lines ~116-136), `matchId` (lines ~140-150), `onNumpadSubmit` (lines ~185-191), and the first `<IdNumpadModal>` mount (lines ~363-369). Keep `matchCheckin`, `onFastCheckinSubmit`, and the fast check-in `<IdNumpadModal>`.

Add selected-entity lookups and picker pin data after the queries:

```tsx
  const selectedWeapon = (weapons.data ?? []).find((w) => w.uid === weaponUid);
  const selectedUser = (users.data ?? []).find((u) => u.uid === userUid);

  // Pin data for the weapon picker: preferred from the selected member,
  // last-used from the member-only eval (weapon deliberately null).
  const pinEval = useQuery({
    queryKey: ['eval', null, userUid],
    queryFn: () => evaluateCheckout(null, userUid),
    enabled: picker === 'weapon' && userUid != null,
  });
```

- [ ] **Step 2: Replace the two `Select` blocks with button-inputs**

Imports: drop `Select`, add `Input`, `CloseButton` from `@mantine/core`; import the pickers:

```tsx
import { WeaponPickerModal } from './WeaponPickerModal';
import { MemberPickerModal } from './MemberPickerModal';
```

Member field (replaces the member `Group` with `Select` + ⌨ button, lines ~227-244):

```tsx
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Input.Wrapper label={t('field_member')} style={{ flex: 1 }}>
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  onClick={() => setPicker('member')}
                  styles={memberError ? { root: { borderColor: 'var(--mantine-color-red-6)' } } : undefined}
                  c={selectedUser ? undefined : 'dimmed'}
                >
                  {selectedUser
                    ? userLabel(selectedUser.name, selectedUser.displayId, selectedUser.active, t)
                    : t('select_member_ph')}
                </Button>
              </Input.Wrapper>
              {userUid != null && (
                <CloseButton
                  size="lg"
                  aria-label={t('clear_selection')}
                  onClick={() => setUserUid(null)}
                />
              )}
            </Group>
```

Weapon field (replaces the weapon `Group` with `Select` + ⌨ button, lines ~249-266), same pattern:

```tsx
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Input.Wrapper label={t('field_weapon')} style={{ flex: 1 }}>
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  onClick={() => setPicker('weapon')}
                  styles={weaponError ? { root: { borderColor: 'var(--mantine-color-red-6)' } } : undefined}
                  c={selectedWeapon ? undefined : 'dimmed'}
                >
                  {selectedWeapon
                    ? weaponLabel(
                        selectedWeapon.brand,
                        selectedWeapon.model,
                        selectedWeapon.caliber,
                        selectedWeapon.displayId,
                        selectedWeapon.active,
                        t,
                      )
                    : t('select_weapon_ph')}
                </Button>
              </Input.Wrapper>
              {weaponUid != null && (
                <CloseButton
                  size="lg"
                  aria-label={t('clear_selection')}
                  onClick={() => setWeaponUid(null)}
                />
              )}
            </Group>
```

The `memberDescription`/`memberError`/`weaponDescription`/`weaponError` `<Text>` lines below each field stay exactly as they are.

- [ ] **Step 3: Mount the pickers**

Where the first `<IdNumpadModal>` used to be, add:

```tsx
      <MemberPickerModal
        opened={picker === 'member'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          onMemberChange(uid);
        }}
      />

      <WeaponPickerModal
        opened={picker === 'weapon'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          onWeaponChange(uid);
        }}
        availableOnly
        pinned={{
          preferredUid: selectedUser?.preferredWeaponUid,
          lastUid: pinEval.data?.lastWeaponUid,
        }}
      />
```

- [ ] **Step 4: Verify build + clean up orphans**

Run: `npm run build`
Expected: PASS. Fix any now-unused imports the rewire created (e.g. `Select`, `Tooltip` if the ⌨ tooltips were its only use — check before removing `Tooltip`; Task 8 adds one back).

- [ ] **Step 5: Commit**

```bash
git add src/CheckoutPage.tsx
git commit -m "feat(checkout): picker modals replace member/weapon dropdowns"
```

---

### Task 8: Favorite star in the return list

**Files:**
- Modify: `src/CheckoutPage.tsx` (open-checkouts card, lines ~313-352 in the pre-Task-7 file)
- Modify: `src/i18n.ts` (both languages)

**Interfaces:**
- Consumes: `setPreferredWeapon` (Task 4), `User.preferredWeaponUid`, existing `users` query + `open` list in CheckoutPage.
- Produces: per-row star button; no API surface for later tasks.

- [ ] **Step 1: Add i18n keys**

`sv`:

```ts
    mark_favorite: 'Gör till favoritvapen',
    unmark_favorite: 'Ta bort som favoritvapen',
```

`en`:

```ts
    mark_favorite: 'Set as favorite weapon',
    unmark_favorite: 'Remove as favorite weapon',
```

- [ ] **Step 2: Add mutation + helper in `CheckoutPage`**

Import `setPreferredWeapon` from `./api` and `ActionIcon` from `@mantine/core`. Near the other mutations:

```tsx
  // Star button: weapon can be one member's favorite. Setting replaces the
  // borrower's previous favorite; tapping their own filled star clears it.
  const favMut = useMutation({
    mutationFn: (args: { userUid: number; weaponUid: number | null }) =>
      setPreferredWeapon(args.userUid, args.weaponUid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
    },
    onError,
  });

  const preferrerOf = (weaponUid: number) =>
    (users.data ?? []).find((u) => u.preferredWeaponUid === weaponUid);
```

- [ ] **Step 3: Render the star in each open-checkout row**

Inside the row's right-hand `<Group gap="xs" wrap="nowrap">`, before the debt button:

```tsx
                    {(() => {
                      const p = preferrerOf(o.weaponUid);
                      if (p && p.uid !== o.userUid) return null; // another member's favorite
                      const mine = p != null;
                      return (
                        <Tooltip label={mine ? t('unmark_favorite') : t('mark_favorite')}>
                          <ActionIcon
                            variant={mine ? 'light' : 'subtle'}
                            color="yellow"
                            size="lg"
                            aria-label={mine ? t('unmark_favorite') : t('mark_favorite')}
                            onClick={() =>
                              favMut.mutate({
                                userUid: o.userUid,
                                weaponUid: mine ? null : o.weaponUid,
                              })
                            }
                          >
                            {mine ? '★' : '☆'}
                          </ActionIcon>
                        </Tooltip>
                      );
                    })()}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/CheckoutPage.tsx src/i18n.ts
git commit -m "feat(checkout): favorite star on return list rows"
```

---

### Task 9: Preferred weapon in member edit + detail

**Files:**
- Modify: `src/MembersPage.tsx` (edit modal form, save/activate mutations, state)
- Modify: `src/MemberDetailPage.tsx` (info grid)
- Modify: `src/i18n.ts` (both languages)

**Interfaces:**
- Consumes: `WeaponPickerModal` (Task 6, `availableOnly` omitted → all active weapons), `setPreferredWeapon`, `listWeapons`, `weaponLabel`.
- Produces: UI only.

- [ ] **Step 1: Add i18n keys**

`sv`:

```ts
    field_preferred_weapon: 'Favoritvapen',
    none_set: 'Inget valt',
```

`en`:

```ts
    field_preferred_weapon: 'Favorite weapon',
    none_set: 'None set',
```

- [ ] **Step 2: MembersPage — state + queries**

Imports: add `Input`, `CloseButton` (Mantine), `listWeapons`, `setPreferredWeapon` (api), `weaponLabel` (labels), `WeaponPickerModal`.

Preference lives outside the `MemberForm` (it is saved by its own command, not `create_user`/`update_user`). Next to `editing` state:

```tsx
  // Preferred weapon: separate from the form — saved via set_preferred_weapon.
  const [prefUid, setPrefUid] = useState<number | null>(null);
  const [prefPickerOpen, setPrefPickerOpen] = useState(false);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const prefWeapon = (weapons.data ?? []).find((w) => w.uid === prefUid);
```

Seed it in `openCreate` (add `setPrefUid(null);`) and `openEdit` (add `setPrefUid(u.preferredWeaponUid);`).

- [ ] **Step 3: MembersPage — save preference with the form**

Both `save` and `activate` mutations persist the preference when it changed:

```tsx
  const savePreference = async (uid: number) => {
    if ((editing?.preferredWeaponUid ?? null) !== prefUid) {
      await setPreferredWeapon(uid, prefUid);
    }
  };

  const save = useMutation({
    mutationFn: async (v: MemberForm) => {
      const u = editing ? await updateUser({ ...v, uid: editing.uid }) : await createUser(v);
      await savePreference(u.uid);
      return u;
    },
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  const activate = useMutation({
    mutationFn: async (v: MemberForm) => {
      if (!editing) throw new Error('no member');
      await updateUser({ ...v, uid: editing.uid });
      await savePreference(editing.uid);
      return setUserActive(editing.uid, true);
    },
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });
```

(If `setPreferredWeapon` rejects — e.g. another member's favorite — the whole save surfaces the translated error and the modal stays open. Good enough; the member row itself was already saved, which matches the two-command reality.)

- [ ] **Step 4: MembersPage — field in the edit modal**

In the form `<Stack>`, after the SSN input:

```tsx
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Input.Wrapper label={t('field_preferred_weapon')} style={{ flex: 1 }}>
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  onClick={() => setPrefPickerOpen(true)}
                  c={prefWeapon ? undefined : 'dimmed'}
                >
                  {prefWeapon
                    ? weaponLabel(
                        prefWeapon.brand,
                        prefWeapon.model,
                        prefWeapon.caliber,
                        prefWeapon.displayId,
                        prefWeapon.active,
                        t,
                      )
                    : t('none_set')}
                </Button>
              </Input.Wrapper>
              {prefUid != null && (
                <CloseButton
                  size="lg"
                  aria-label={t('clear_selection')}
                  onClick={() => setPrefUid(null)}
                />
              )}
            </Group>
```

Mount the picker next to the other modals (bottom of the component):

```tsx
      <WeaponPickerModal
        opened={prefPickerOpen}
        onClose={() => setPrefPickerOpen(false)}
        onSelect={(uid) => {
          setPrefUid(uid);
          setPrefPickerOpen(false);
        }}
      />
```

- [ ] **Step 5: MemberDetailPage — info row**

Add imports `listWeapons` and `weaponLabel` (already imports `userLabel`/`weaponLabel` — check; `weaponLabel` is already imported). Add query + row:

```tsx
  const weaponsQ = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
```

After `const u = userQ.data;`:

```tsx
  const prefWeapon = (weaponsQ.data ?? []).find((w) => w.uid === u.preferredWeaponUid);
```

In the `info` array, after the SSN entry:

```tsx
    [
      t('field_preferred_weapon'),
      prefWeapon
        ? weaponLabel(
            prefWeapon.brand,
            prefWeapon.model,
            prefWeapon.caliber,
            prefWeapon.displayId,
            prefWeapon.active,
            t,
          )
        : '—',
    ],
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/MembersPage.tsx src/MemberDetailPage.tsx src/i18n.ts
git commit -m "feat(members): preferred weapon in edit form and detail view"
```

---

### Task 10: Seed data + full verification

**Files:**
- Modify: `src-tauri/src/seed.rs` (imports line ~20; after the weapons loop, line ~162)

**Interfaces:**
- Consumes: `user_set_preferred_weapon` (Task 2).
- Produces: dev dataset with favorites, so pickers/star/autofill are live-smokable.

- [ ] **Step 1: Extend the seed**

Add `user_set_preferred_weapon` to the `crate::commands` import (line ~20). After the weapons loop (line ~162), add:

```rust
    // --- Preferred weapons: a few members favor a specific weapon (exclusive,
    // one member per weapon — mirrors the partial unique index). ---
    for (ui, wi) in [(2usize, 0usize), (5, 3), (9, 7)] {
        user_set_preferred_weapon(conn, user_uids[ui], Some(weapon_uids[wi]))?;
    }
```

(If a chosen user/weapon index collides with the entities the seed later retires, shift the index by one — the seed test will catch a failure.)

- [ ] **Step 2: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, including `seeds_expected_counts_and_is_idempotent`.

- [ ] **Step 3: Full frontend build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/seed.rs
git commit -m "feat(seed): preferred weapons in dev dataset"
```

- [ ] **Step 5: Hand off for live-smoke (user-run, required before merge)**

Ask the user to `npm run seed` (app closed), then `npm run tauri dev` and check:

1. Checkout: member button opens member picker (numpad prefix + name search work; boxes tap-select).
2. Picking a member with a favorite auto-fills that weapon; weapon picker shows ★ favorite first, "last used" second.
3. Weapon picker filters: brand, caliber, free text, tag prefix.
4. Return list: ☆ on a nobody's-favorite weapon sets it (★); tapping ★ clears; a weapon favored by a *different* member shows no star.
5. Member edit: set/clear favorite weapon; exclusivity error is translated and names the competing member.
6. Member detail shows the favorite; fast check-in still works.

Merge to `main` only after the user confirms.
