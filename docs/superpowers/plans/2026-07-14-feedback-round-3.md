# Feedback Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix intermittent open-checkouts staleness (Tauri networkMode), icon buttons on return-list rows, clear favorite on member deactivation, import favorite weapon from the sheet's `vapen` column.

**Architecture:** One QueryClient config fix, one dependency (+UI swap), one backend rule change, one import pipeline extension (parse → plan → commit).

**Tech Stack:** Tauri 2 (Rust/rusqlite, calamine xlsx) · React + TS + Mantine v9 + @tabler/icons-react (new) · TanStack Query v5.

**Branch:** `feat/picker-modals-preferred-weapon` (continues unmerged branch).

## Global Constraints

- Business rules in Rust; every new/changed command behavior gets a cargo test. `cargo test --manifest-path src-tauri/Cargo.toml` + `npm run build` green per task.
- i18n sv+en for any new UI copy; `e.target` in onChange; append-only logs untouched.
- Import warnings follow the existing `ImportWarning { row, code, message }` pattern (message is the operator-facing fallback; codes prefixed `warn_`).
- Exclusive favorite invariant: one member per weapon (partial unique index; `user_set_preferred_weapon` pre-checks and names the competitor).
- Commit after each task.

---

### Task 1: TanStack `networkMode: 'always'` (open-checkouts staleness fix)

**Files:**
- Modify: `src/App.tsx` (QueryClient, line 23)

**Why (root cause):** TanStack Query v5 defaults to `networkMode: 'online'` — when the WebView reports `navigator.onLine === false`, refetches (including the post-checkout `['openCheckouts']` invalidation) and mutations are silently PAUSED until "online" returns. Tauri `invoke` is IPC, not network; the app must query regardless of connectivity. Matches the observed intermittent "sometimes the list doesn't update".

- [ ] **Step 1: Configure the client**

Replace `const queryClient = new QueryClient();` with:

```tsx
// Tauri invoke is IPC, not HTTP — never pause queries/mutations on
// navigator.onLine (default networkMode 'online' froze refetches when the
// WebView thought it was offline, leaving the open-checkouts list stale).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → PASS

```bash
git add src/App.tsx
git commit -m "fix(query): networkMode always — Tauri IPC must not pause on offline WebView"
```

---

### Task 2: Icon buttons for add-debt / return

**Files:**
- Modify: `package.json` (+ lockfile) — new dependency `@tabler/icons-react`
- Modify: `src/CheckoutPage.tsx` (open-checkouts row buttons, ~lines 362-381)

**Interfaces:**
- Consumes: existing `setDebtUser`/`checkinMut` wiring, existing i18n keys `add_debt`/`return_weapon`.
- Produces: UI only.

- [ ] **Step 1: Install the Mantine-standard icon set**

Run: `npm install @tabler/icons-react`
(Tree-shakeable; Mantine's documented companion. This is the project's first icon dependency — approved by the user's explicit request for icons.)

- [ ] **Step 2: Swap the two text Buttons for ActionIcons**

In `src/CheckoutPage.tsx` imports add:

```tsx
import { IconCoins, IconArrowBackUp } from '@tabler/icons-react';
```

Replace the debt `<Button variant="subtle" color="red" ...>{t('add_debt')}</Button>` and return `<Button variant="light" color="teal" ...>{t('return_weapon')}</Button>` in the open-checkouts row with (same handlers, same order, keeping the star ActionIcon before them):

```tsx
                    <Tooltip label={t('add_debt')}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="lg"
                        aria-label={t('add_debt')}
                        onClick={() =>
                          setDebtUser({
                            uid: o.userUid,
                            name: userLabel(o.userName, o.userDisplayId, o.userActive, t),
                          })
                        }
                      >
                        <IconCoins />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('return_weapon')}>
                      <ActionIcon
                        variant="light"
                        color="teal"
                        size="lg"
                        aria-label={t('return_weapon')}
                        loading={checkinMut.isPending}
                        onClick={() => checkinMut.mutate(o.id)}
                      >
                        <IconArrowBackUp />
                      </ActionIcon>
                    </Tooltip>
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → PASS

```bash
git add package.json package-lock.json src/CheckoutPage.tsx
git commit -m "feat(checkout): icon buttons for add-debt and return (tabler icons)"
```

---

### Task 3: Deactivating a member clears their favorite weapon

**Files:**
- Modify: `src-tauri/src/commands.rs` (`user_set_active`, both deactivate branches; tests)
- Modify: `BACKLOG.md` (resolve the retired-member-retains-slot entry)

**Interfaces:**
- Consumes: existing `user_set_active`.
- Produces: rule — deactivation frees the weapon for another member's claim. Reactivation does NOT restore the old favorite.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/commands.rs` tests:

```rust
    #[test]
    fn deactivating_member_clears_preferred_weapon() {
        let conn = migrated_in_memory();
        let a = user_create(&conn, new_user("Anna", Some("10"), false)).unwrap();
        let b = user_create(&conn, new_user("Björn", Some("11"), false)).unwrap();
        let w = weapon_create(&conn, new_weapon(Some("W1"), Some("S-1"))).unwrap();

        user_set_preferred_weapon(&conn, a.uid, Some(w.uid)).unwrap();
        let a = user_set_active(&conn, a.uid, false, false).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
        // Freed slot is claimable by another member.
        let b = user_set_preferred_weapon(&conn, b.uid, Some(w.uid)).unwrap();
        assert_eq!(b.preferred_weapon_uid, Some(w.uid));
        // Reactivation does not restore the old favorite.
        let a = user_set_active(&conn, a.uid, true, false).unwrap();
        assert_eq!(a.preferred_weapon_uid, None);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml deactivating_member_clears`
Expected: FAIL — `assert_eq!(a.preferred_weapon_uid, None)` (favorite survives deactivation today).

- [ ] **Step 3: Implement**

In `user_set_active`, the two `active = false` branches (`clear_display_id` true/false) each get `preferred_weapon_uid = NULL` added to their UPDATE:

```rust
    } else if clear_display_id {
        // Free the physical tag so it can be reassigned to another member.
        // Deactivation also frees the member's favorite weapon for others.
        conn.execute(
            "UPDATE users SET active = 0, display_id = NULL, preferred_weapon_uid = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    } else {
        conn.execute(
            "UPDATE users SET active = 0, preferred_weapon_uid = NULL, updated_at = ?2 WHERE uid = ?1",
            params![uid, now_utc()],
        )?;
    }
```

- [ ] **Step 4: Resolve the BACKLOG entry**

In `BACKLOG.md`, the entry about retired members retaining the preferred-weapon slot: mark done/remove per the file's convention (it's a `- [ ]` checkbox — tick it and append "— resolved: deactivation clears the favorite").

- [ ] **Step 5: Full suite + commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` → PASS (63 tests)

```bash
git add src-tauri/src/commands.rs BACKLOG.md
git commit -m "feat(members): deactivation clears preferred weapon, freeing it for others"
```

---

### Task 4: Import favorite weapon from the `vapen` column

**Files:**
- Modify: `src-tauri/src/import.rs` (parse, plan, commit, tests)

**Context (read the file first — 1059 lines):** sheet layout contract at `parse_xlsx` (~line 199): header row index 2 has `col0=Navn, col1=Person nummer, col2=vapen, col3=flag`, then utlev/inlev pairs. Col index 2 (`vapen`) is currently unread — it holds the member's favorite weapon number (tag). Pipeline: `parse_xlsx` → `ParsedSheet{ParsedMember}` → `build_plan` (read-only, dedup/lookup maps) → preview or commit. Commit creates members/weapons/loans via the real create fns and resolves `weapon_no → uid` / `member row → uid` maps.

**Rules:**
- Parse: `favorite_weapon_no: Option<String>` on `ParsedMember` from `row.get(2)` when `is_weapon_no(v)`; non-numeric junk in that cell → existing-style warning (`warn_junk_cell` message naming the cell) and `None`. On within-file duplicate-member merge, keep the FIRST non-empty favorite.
- Plan: favorite weapon numbers join the `all_weapon_nos` set (so a favorite referencing a weapon absent from loan history still gets created as an active weapon with that tag, same as loan weapons).
- Commit: after members + weapons exist, for each parsed member with a favorite: resolve member uid + weapon uid from the commit's maps, then set via `crate::commands::user_set_preferred_weapon`, with guards:
  - Member already has a `preferred_weapon_uid` (pre-existing member) → skip, no warning (import never overwrites a live preference).
  - `user_set_preferred_weapon` returns Err (weapon already another member's favorite — first row wins within the file) → push `ImportWarning { row: member's row, code: "warn_favorite_conflict", message: "Row {row}: favorite weapon {no} already belongs to another member — skipped" }`, continue.
- No `ImportPreview`/`ImportResult` struct changes (warnings carry the signal — they already render in the preview UI).

- [ ] **Step 1: Write the failing tests**

In `import.rs`'s test module, following its existing test style (they build xlsx fixtures or ParsedSheet structs — mirror whatever pattern is there; if tests operate on `build_plan`/commit with hand-built `ParsedSheet`, do the same):

```rust
    // 1. favorite parsed from col 2 and applied on commit
    //    - member row with favorite_weapon_no "7", no loan referencing "7"
    //    - after commit: member's preferred_weapon_uid = the created weapon with tag "7"
    //      (weapon created even though it appears in no loan)
    // 2. conflict: two members with the same favorite "7"
    //    - first (lowest row) gets it; second → warning code "warn_favorite_conflict"
    // 3. existing member with a live preference is not overwritten
    //    - pre-create member+weapon, set_preferred_weapon to W_A; import file says W_B
    //    - after commit: preference still W_A (and no error)
```

Write these as real tests with real asserts (the comment block above is the required coverage, not the test body).

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml import`
Expected: FAIL to compile (`favorite_weapon_no` missing) or assert failures.

- [ ] **Step 3: Implement parse → plan → commit per the Rules above**

Keep each addition adjacent to the analogous existing code (favorite parse next to the ssn parse; `all_weapon_nos` extension one line; commit favorites loop after the loans loop). Import `user_set_preferred_weapon` alongside the other `crate::commands` imports already used by commit.

- [ ] **Step 4: Full suite + build + commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` → PASS
Run: `npm run build` → PASS (no TS changes expected — confirm nothing drifted)

```bash
git add src-tauri/src/import.rs
git commit -m "feat(import): favorite weapon from vapen column (exclusive, first wins, never overwrites)"
```

---

## Verification & handoff (controller)

Full suites after Task 4; wave review; user live-smoke additions: checkout → list updates immediately (repeatedly), icons on return rows, deactivate member with favorite → another member can claim it, re-import real xlsx → favorites populated + conflict warnings visible in preview.
