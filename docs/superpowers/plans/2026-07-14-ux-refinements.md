# UX Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten UX refinements: scrollable lists with sticky headers, app-wide text-selection off, member/weapon info modals, member-first checkout flow, stable member sort, and debt/in-use indicators moved into the pickers.

**Architecture:** Tauri 2 desktop app. All DB access via Rust `#[tauri::command]`s (`src-tauri/src/`); React + TypeScript + Mantine v9 frontend (`src/`) using TanStack Query for all `invoke` calls. Two small backend changes (trim `CheckoutEval`, extend `last_shot_dates`); everything else is frontend.

**Tech Stack:** Rust/rusqlite, React 18, TypeScript, Mantine v9, TanStack Query, react-i18next (sv + en), Vite.

**Spec:** `docs/superpowers/specs/2026-07-14-ux-refinements-design.md`

## Global Constraints

- Branch: `feat/ux-refinements` already exists — all work happens there; commit after every task.
- Every user-facing string is an i18n key in `src/i18n.ts` with BOTH `sv` and `en` entries. Never hardcode UI copy.
- Verification commands (both must be green when a task claims them):
  - Frontend: `npm run build` (run from repo root `/Users/tom.stevens/git/shooting-range-log`)
  - Backend: `cargo test --manifest-path src-tauri/Cargo.toml`
- Tauri arg convention: JS passes camelCase, Rust receives snake_case. Rust structs serialize with `#[serde(rename_all = "camelCase")]`.
- Log tables are append-only; never reintroduce snapshot columns. No schema change is needed anywhere in this plan (no new migration).
- Time stored UTC RFC3339; display via `src/format.ts` helpers.
- Match existing code style; comment only constraints code can't show.
- UI rendering cannot be verified by build/tests — final acceptance is the user's live-smoke in `npm run tauri dev` (do not attempt to run it yourself; it launches a GUI).

---

### Task 1: Disable text selection app-wide

**Files:**
- Create: `src/global.css`
- Modify: `src/App.tsx` (add import)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Create `src/global.css`**

```css
/* Kiosk-style touch UI: no text selection anywhere except text entry. */
* {
  -webkit-user-select: none;
  user-select: none;
}
input,
textarea {
  -webkit-user-select: text;
  user-select: text;
}
```

- [ ] **Step 2: Import it in `src/App.tsx`**

After the existing style imports (line 4, `import '@mantine/dates/styles.css';`), add:

```ts
import './global.css';
```

Note: `src/App.css` exists but is dead (never imported) — leave it untouched.

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/global.css src/App.tsx
git commit -m "ui: disable text selection app-wide except inputs"
```

---

### Task 2: Backend — `last_shot_dates` returns last-shot-before-today

**Files:**
- Modify: `src-tauri/src/logs.rs` (struct `LastShot` ~line 126, query fn `last_shot_dates_q` ~line 133, tests)
- Modify: `src/api.ts` (interface `LastShot` ~line 204)

**Interfaces:**
- Consumes: existing `checkouts` table.
- Produces: `LastShot { user_uid: i64, last_shot_at: String, last_shot_before_today: Option<String> }`, serialized camelCase → TS `LastShot { userUid: number; lastShotAt: string; lastShotBeforeToday: string | null }`. Task 3 sorts by `lastShotBeforeToday` and displays `lastShotAt`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module at the bottom of `src-tauri/src/logs.rs`:

```rust
    #[test]
    fn last_shot_dates_excludes_today_from_before_today() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", true);
        let anna = mk_user(&conn, "Anna", false);
        let bjorn = mk_user(&conn, "Björn", false);
        let w1 = mk_weapon(&conn, "W1");
        let w2 = mk_weapon(&conn, "W2");

        // Anna: one checkout yesterday (raw insert — do_checkout always stamps now),
        // one today via the real fn.
        let yesterday = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
        conn.execute(
            "INSERT INTO checkouts (weapon_uid, user_uid, operator_out_uid, checked_out_at, checked_in_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![w1, anna, op, yesterday],
        )
        .unwrap();
        let today = do_checkout(&conn, w1, anna, op, None).unwrap();

        // Björn: only today.
        do_checkout(&conn, w2, bjorn, op, None).unwrap();

        let rows = last_shot_dates_q(&conn).unwrap();
        let a = rows.iter().find(|r| r.user_uid == anna).unwrap();
        assert_eq!(a.last_shot_at, today.checked_out_at);
        assert_eq!(a.last_shot_before_today.as_deref(), Some(yesterday.as_str()));
        let b = rows.iter().find(|r| r.user_uid == bjorn).unwrap();
        assert!(b.last_shot_before_today.is_none());
    }
```

(`params!` is already imported at the top of logs.rs; `chrono` is a workspace dependency used by checkout.rs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml last_shot_dates_excludes_today`
Expected: FAIL to compile — `last_shot_before_today` field does not exist.

- [ ] **Step 3: Implement**

In `src-tauri/src/logs.rs`, extend the struct (keep the existing doc comment, append to it):

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastShot {
    pub user_uid: i64,
    pub last_shot_at: String,
    /// Most recent shot strictly before today (local time); None when the member's
    /// only shooting is today. The checkout member picker sorts by this so
    /// today's activity doesn't reshuffle the list mid-session.
    pub last_shot_before_today: Option<String>,
}
```

Replace `last_shot_dates_q`:

```rust
fn last_shot_dates_q(conn: &Connection) -> Result<Vec<LastShot>, AppError> {
    // checked_out_at is UTC RFC3339 ("...Z"); date(x, 'localtime') converts to the
    // operator's local calendar day, matching what "today" means at the counter.
    let mut stmt = conn.prepare(
        "SELECT user_uid,
                MAX(checked_out_at) AS last_shot_at,
                MAX(CASE WHEN date(checked_out_at, 'localtime') < date('now', 'localtime')
                         THEN checked_out_at END) AS last_shot_before_today
         FROM checkouts GROUP BY user_uid",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LastShot {
            user_uid: r.get(0)?,
            last_shot_at: r.get(1)?,
            last_shot_before_today: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
```

- [ ] **Step 4: Run backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all PASS (including the pre-existing `last_shot_dates_returns_max_per_member_and_skips_non_shooters`).

- [ ] **Step 5: Mirror the type in `src/api.ts`**

Replace the `LastShot` interface (~line 204):

```ts
export interface LastShot {
  userUid: number;
  lastShotAt: string;
  lastShotBeforeToday: string | null;
}
```

- [ ] **Step 6: Verify frontend still builds**

Run: `npm run build`
Expected: exit 0 (field is additive; no consumer breaks).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/logs.rs src/api.ts
git commit -m "feat(logs): last_shot_dates also returns last shot before today"
```

---

### Task 3: Member picker — sort by last-shot-before-today + debt badge

**Files:**
- Modify: `src/MemberPickerModal.tsx`
- Modify: `src/i18n.ts` (no new keys — reuses `debt_badge`)

**Interfaces:**
- Consumes: `LastShot.lastShotBeforeToday` (Task 2), existing `outstandingDebts()` → `OutstandingDebt { userUid, amountKr }` from `src/api.ts`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Update imports and data maps**

In `src/MemberPickerModal.tsx`:

Imports — add `Group` and `Badge` to the `@mantine/core` import; add `outstandingDebts` to the `./api` import:

```ts
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
} from '@mantine/core';
```
```ts
import { lastShotDates, listUsers, outstandingDebts, type User } from './api';
```

After the existing `shots` query (line 41), add the debts query and the two maps (the existing `lastMap` line stays as-is):

```ts
  const debts = useQuery({
    queryKey: ['outstandingDebts'],
    queryFn: outstandingDebts,
    enabled: opened,
  });
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));
  // Sort key: last shot BEFORE today — checking a member out today must not
  // reshuffle the list for the rest of the session. Display still shows lastMap.
  const beforeMap = new Map(
    (shots.data ?? [])
      .filter((s) => s.lastShotBeforeToday != null)
      .map((s) => [s.userUid, s.lastShotBeforeToday!] as const),
  );
```

- [ ] **Step 2: Sort by the before-today map**

In the `sorted` comparator (lines 52-63), change the two lookups from `lastMap` to `beforeMap`:

```ts
    const av = beforeMap.get(a.uid);
    const bv = beforeMap.get(b.uid);
```

(The rest of the comparator — exact-tag rank, most-recent-first, `sv` name tiebreak — stays identical.)

- [ ] **Step 3: Add the right-aligned debt badge to rows**

Replace the row Card content (the `<Stack gap={2}>…</Stack>` inside the map, lines 80-87) with:

```tsx
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{userLabel(u.name, u.displayId, true, t)}</Text>
                      {lastMap.has(u.uid) && (
                        <Text size="xs" c="dimmed">
                          {t('field_last_shot')}: {fmtDate(lastMap.get(u.uid)!)}
                        </Text>
                      )}
                    </Stack>
                    {debtMap.has(u.uid) && (
                      <Badge color="red" variant="filled">
                        {t('debt_badge', { amount: debtMap.get(u.uid) })}
                      </Badge>
                    )}
                  </Group>
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/MemberPickerModal.tsx
git commit -m "ui(checkout): member picker sorts by pre-today shot date, shows debt badge"
```

---

### Task 4: Checkout page — member-first flow, no clear buttons, fewer banners

**Files:**
- Modify: `src/CheckoutPage.tsx`
- Modify: `src/i18n.ts` (add 1 key, delete 6 keys — both `sv` and `en` blocks)

**Interfaces:**
- Consumes: existing `CheckoutEval.suggestedWeaponUid` / `suggestedWeaponOut` (these SURVIVE Task 5's trim — do not remove them).
- Produces: CheckoutPage stops reading `suggestedUser*` and `fresherUser*` eval fields — precondition for Task 5.

- [ ] **Step 1: Rework selection handlers in `src/CheckoutPage.tsx`**

Delete `onWeaponChange` (lines 64-74 including the comment block) and replace `onMemberChange` (lines 76-83) with:

```ts
  // Member drives the flow: picking a member autofills their suggested weapon
  // (preferred, else last-used) or clears the field when nothing is available.
  const onMemberChange = async (uid: number) => {
    setUserUid(uid);
    const e = await evaluateCheckout(null, uid);
    setWeaponUid(
      e.suggestedWeaponUid != null && !e.suggestedWeaponOut ? e.suggestedWeaponUid : null,
    );
  };
```

Update the `WeaponPickerModal` `onSelect` (line 456-459) to set the uid directly:

```tsx
        onSelect={(uid) => {
          setPicker(null);
          setWeaponUid(uid);
        }}
```

- [ ] **Step 2: Remove both clear buttons**

Delete the member `CloseButton` block (lines 252-258) and the weapon `CloseButton` block (lines 287-293), i.e. both `{userUid != null && (<CloseButton …/>)}` / `{weaponUid != null && (<CloseButton …/>)}` fragments. Remove `CloseButton` from the `@mantine/core` import (it has no other use in this file).

- [ ] **Step 3: Disable weapon picker until a member is chosen**

On the weapon `<Button>` (line 266), add a `disabled` prop:

```tsx
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  disabled={userUid == null}
                  onClick={() => setPicker('weapon')}
```

Below the weapon field's `Group`, first line inside the weapon `<Stack gap={4}>` after the Group closes (i.e. where the description texts render, before `weaponError`), add:

```tsx
            {userUid == null && (
              <Text fz="xs" c="dimmed">
                {t('choose_member_first')}
              </Text>
            )}
```

- [ ] **Step 4: Delete moved/dead notices**

Remove these computations and their renders:

- `weaponDescription` (lines 161-167) and its render `{weaponDescription && …}` (line 295) — fresher-user note, now lives in the weapon picker's "Last:" line.
- `memberDescription` (lines 172-175) and its render (line 260) — debt banner, now a badge in the member picker.
- `favoriteOut` (lines 177-192) and its render `{favoriteOut && <Alert …>}` (line 326).
- `weaponFavoriteNote` (lines 194-200) and its render (line 296) — the ★-badge in the weapon picker covers it.
- The `suggestedUserBusy` Alert (lines 300-311) and the `suggestedWeaponOut` Alert (lines 312-325).

Keep: `weaponError` (inactive / already-out) and `memberError` (inactive) — hard errors stay on the page.

Remove `Alert` from the `@mantine/core` import (no remaining use). Keep `fmtDateTime`, `weaponLabel`, `userLabel`, `preferrerOf` (all still used by the open-loans list / fast check-in).

- [ ] **Step 5: i18n — add and delete keys**

In `src/i18n.ts`, BOTH language blocks:

Delete these six keys from `sv` (lines 119-124) and their `en` mirrors (~lines 364-369): `banner_debt`, `banner_fresher`, `banner_suggested_user_busy`, `banner_suggested_weapon_out`, `banner_favorite_out`, `banner_weapon_is_favorite`.

Add (next to `select_member_ph` in each block):

```ts
      choose_member_first: 'Välj medlem först.',
```
```ts
      choose_member_first: 'Choose a member first.',
```

Keep `banner_weapon_inactive`, `banner_weapon_inactive_noreason`, `banner_weapon_already_out`, `banner_user_inactive`, and `clear_selection` (still used by MembersPage's preferred-weapon clear).

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: exit 0. Also grep to prove no leftovers:
`grep -rn "banner_fresher\|banner_favorite_out\|banner_suggested\|banner_debt\|banner_weapon_is_favorite" src/`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add src/CheckoutPage.tsx src/i18n.ts
git commit -m "feat(checkout): member-first flow; weapon follows member; drop moved banners"
```

---

### Task 5: Backend — remove weapon-first eval fields

**Files:**
- Modify: `src-tauri/src/checkout.rs`
- Modify: `src/api.ts` (interface `CheckoutEval`)
- Modify: `src-tauri/src/logs.rs` (one stale comment)

**Interfaces:**
- Consumes: Task 4 must be done first (frontend no longer reads the removed fields).
- Produces: trimmed `CheckoutEval` — keeps `suggested_weapon_*`, `suggested_weapon_out`, `last_weapon_uid`, `weapon_inactive*`, `weapon_already_out`, `open_holder_*`, `open_checkout_id`, `user_inactive`, `user_outstanding_debt_kr`, `can_checkout`. Removes `suggested_user_uid/name/display_id/active`, `suggested_user_busy`, `fresher_user_name/display/active/at`.

- [ ] **Step 1: Trim the struct**

In `CheckoutEval` (checkout.rs lines 78-117) delete the five `suggested_user_*` fields (with their doc comments) and the four `fresher_user_*` fields. Everything else stays.

- [ ] **Step 2: Trim `evaluate`**

- Delete `let mut most_recent: Option<(i64, String)> = None;` (line 203) and `most_recent = most_recent_checkout(conn, wuid)?;` (line 219).
- Delete the whole `if !eval.weapon_already_out { … }` block (lines 230-257, the suggestion/fresher-user match).
- Delete the now-unused helper fns `most_recent_checkout` (lines 119-134) and `user_has_open` (lines 169-179), including doc comments.
- Update the module doc comment at the top: drop the word "autopopulate + render banners" claim only if it mentions user suggestion; a minimal edit — change the second sentence of the `//!` block to:

```rust
//! `evaluate_checkout` computes everything the UI needs to autofill the weapon
//! and render notices (rules live here, not in JS). `checkout` re-validates
```

- [ ] **Step 3: Fix tests**

In checkout.rs tests:

- Delete `suggestion_and_fresher_user` (lines 496-530) entirely.
- Delete `suggested_user_busy_and_fresher_suppressed_when_out` (lines 566-589) entirely.
- In `already_out_blocks_and_checkin_frees`: no change (touches none of the removed fields).
- All other tests compile untouched (`member_to_weapon_suggestion`, `preferred_weapon_*`, `last_weapon_uid_exposed_without_preference`, `outstanding_debt_sums_unsettled` use only surviving fields).

- [ ] **Step 4: Fix stale comment in logs.rs**

`logs.rs` line ~154 says "same ordering as `checkout::most_recent_checkout`" — that fn is gone. Change the comment to:

```rust
/// Most recent user per weapon (latest checkout row; `checked_out_at DESC,
/// id DESC` tiebreak). Identity resolved live by uid. Weapons with no history
/// are absent.
```

- [ ] **Step 5: Run backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all PASS; also `cargo build` warns about nothing (no dead_code warnings — the helpers were removed, not orphaned).

- [ ] **Step 6: Trim the TS mirror**

In `src/api.ts` `CheckoutEval` (lines 96-125) delete: `suggestedUserUid`, `suggestedUserName`, `suggestedUserDisplayId`, `suggestedUserActive`, `suggestedUserBusy`, `fresherUserName`, `fresherUserDisplay`, `fresherUserActive`, `fresherUserAt`.

- [ ] **Step 7: Verify frontend**

Run: `npm run build`
Expected: exit 0 (Task 4 already removed all readers).
Also: `grep -rn "suggestedUser\|fresherUser" src/` — no matches.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/checkout.rs src-tauri/src/logs.rs src/api.ts
git commit -m "refactor(checkout): drop weapon-first suggestion fields from evaluate"
```

---

### Task 6: Weapon picker — show checked-out weapons disabled with holder

**Files:**
- Modify: `src/WeaponPickerModal.tsx`
- Modify: `src/i18n.ts` (1 new key, both languages)

**Interfaces:**
- Consumes: existing `listOpenCheckouts()` rows (`OpenCheckout.userName/userDisplayId/userActive/weaponUid`).
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Keep out weapons in the pool, map them to their open row**

In `src/WeaponPickerModal.tsx` replace the `outSet` line (line 60) with:

```ts
  // weapon uid → its open checkout (holder shown on the disabled row).
  const outMap = new Map((open.data ?? []).map((o) => [o.weaponUid, o] as const));
```

Replace the `pool` filter (lines 75-77) with:

```ts
  const pool = (weapons.data ?? []).filter((w) => w.active);
```

- [ ] **Step 2: Render out weapons greyed and unclickable, with holder**

Replace the row map body (lines 115-158, the `sorted.map((w) => (<Card …/>))`) with:

```tsx
              {sorted.map((w) => {
                const out = availableOnly ? outMap.get(w.uid) : undefined;
                return (
                  <Card
                    key={w.uid}
                    withBorder
                    padding="sm"
                    opacity={out ? 0.5 : 1}
                    style={{ cursor: out ? 'default' : 'pointer' }}
                    onClick={out ? undefined : () => onSelect(w.uid)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={2}>
                        <Text fw={600}>{label(w)}</Text>
                        {out ? (
                          <Text size="xs" c="red.7">
                            {t('picker_out_held_by', {
                              name: userLabel(out.userName, out.userDisplayId, out.userActive, t),
                            })}
                          </Text>
                        ) : (
                          lastUseMap.has(w.uid) && (
                            <Text size="xs" c="dimmed">
                              {t('picker_last_used', {
                                name: userLabel(
                                  lastUseMap.get(w.uid)!.userName,
                                  lastUseMap.get(w.uid)!.userDisplayId,
                                  lastUseMap.get(w.uid)!.userActive,
                                  t,
                                ),
                                date: fmtDate(lastUseMap.get(w.uid)!.lastUsedAt),
                              })}
                            </Text>
                          )
                        )}
                      </Stack>
                      <Group gap={4} wrap="nowrap">
                        {w.uid === pinned?.preferredUid ? (
                          <Badge color="yellow" variant="light">
                            ★ {t('badge_preferred')}
                          </Badge>
                        ) : preferrerMap.has(w.uid) ? (
                          <Badge color="yellow" variant="light">
                            ★ {preferrerMap.get(w.uid)!.name}
                          </Badge>
                        ) : null}
                        {w.uid === pinned?.lastUid && (
                          <Badge color="gray" variant="light">
                            {t('badge_last')}
                          </Badge>
                        )}
                      </Group>
                    </Group>
                  </Card>
                );
              })}
```

(When a weapon is out, the current holder IS its most recent user — the "Last:" line would duplicate the holder, so the held-by line replaces it. Sort order deliberately unchanged: an out favorite stays pinned on top with its ★ badge + red held-by line, which is exactly the "your favorite is in use by X" warning.)

Also update the component's leading comment (lines 21-24) — `availableOnly` no longer filters out weapons; it disables them:

```tsx
// Touch-first weapon selector: box list left, tag numpad + filters right.
// `pinned` floats the member's preferred / last-used weapon to the top with
// badges. `availableOnly` (checkout) greys out currently-out weapons and shows
// the holder; otherwise all active weapons are selectable (member edit).
```

- [ ] **Step 3: i18n key**

Add next to `picker_last_used` in both blocks of `src/i18n.ts`:

```ts
      picker_out_held_by: 'Utlånad till {{name}}',
```
```ts
      picker_out_held_by: 'Out — held by {{name}}',
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/WeaponPickerModal.tsx src/i18n.ts
git commit -m "ui(checkout): weapon picker shows out weapons disabled with holder name"
```

---

### Task 7: Open-loans debt button highlights when member owes

**Files:**
- Modify: `src/CheckoutPage.tsx`

**Interfaces:**
- Consumes: existing `outstandingDebts()` from `src/api.ts`. `DebtModal` already invalidates `['outstandingDebts']` on mutations (DebtModal.tsx:47) — no invalidation work needed.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Fetch the debt map**

In `src/CheckoutPage.tsx`, add `outstandingDebts` to the `./api` import. Under the `open` query (line 55), add:

```ts
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const debtMap = new Map((debts.data ?? []).map((d) => [d.userUid, d.amountKr] as const));
```

- [ ] **Step 2: Style the button by debt state**

In the open-loans debt `ActionIcon` (line 399-414), change `variant="subtle"` to:

```tsx
                        variant={debtMap.has(o.userUid) ? 'filled' : 'subtle'}
```

(Color stays `red`; always clickable — adding a first debt from the row must remain possible.)

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/CheckoutPage.tsx
git commit -m "ui(checkout): open-loans debt button filled when member owes"
```

---

### Task 8: Member + weapon info modals; delete MemberDetailPage

**Files:**
- Create: `src/MemberInfoModal.tsx`
- Create: `src/WeaponInfoModal.tsx`
- Modify: `src/MembersPage.tsx` (row click opens modal instead of navigating)
- Modify: `src/App.tsx` (drop route + import)
- Delete: `src/MemberDetailPage.tsx`
- Modify: `src/i18n.ts` (add `usage_history` sv+en; delete `back` sv+en)

**Interfaces:**
- Consumes: existing api fns `getUser`, `getWeapon`, `listCheckouts`, `listWeapons`, `listWeaponService`.
- Produces: `MemberInfoModal({ uid: number | null, opened: boolean, onClose: () => void })` and `WeaponInfoModal({ uid: number | null, opened: boolean, onClose: () => void })` — Task 9 mounts these on CheckoutPage and LogsPage with exactly these props.

- [ ] **Step 1: Create `src/MemberInfoModal.tsx`**

Content is MemberDetailPage's info grid + history, in a Modal (no back button, no route handling):

```tsx
import {
  Modal,
  Stack,
  Title,
  Badge,
  Table,
  Text,
  SimpleGrid,
  ScrollArea,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { getUser, listCheckouts, listWeapons } from './api';
import { userLabel, weaponLabel } from './labels';
import { fmtDateTime } from './format';

// Read-only member view: all member fields + shooting history. Launched from
// the members list, the open-loans list, and log rows.
export function MemberInfoModal({
  uid,
  opened,
  onClose,
}: {
  uid: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enabled = opened && uid != null;

  const userQ = useQuery({
    queryKey: ['user', uid],
    queryFn: () => getUser(uid!),
    enabled,
  });
  const historyQ = useQuery({
    queryKey: ['checkouts', { userUid: uid }],
    queryFn: () => listCheckouts({ userUid: uid }),
    enabled,
  });
  const weaponsQ = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled });

  const u = userQ.data;
  const prefWeapon = (weaponsQ.data ?? []).find((w) => w.uid === u?.preferredWeaponUid);

  const info: [string, ReactNode][] = u
    ? [
        [t('field_email'), u.email ?? '—'],
        [t('field_phone'), u.phone ?? '—'],
        [t('field_address'), u.address ?? '—'],
        [t('field_ssn'), u.ssn ?? '—'],
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
        [
          t('status'),
          <Badge color={u.active ? 'teal' : 'gray'} variant="light">
            {u.active ? t('active') : t('inactive')}
          </Badge>,
        ],
        [t('field_notes'), u.notes ?? '—'],
      ]
    : [];

  const history = historyQ.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={u ? userLabel(u.name, u.displayId, u.active, t) : ''}
      size="xl"
      centered
    >
      {u && (
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="sm">
            {info.map(([label, value]) => (
              <div key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text component="div">{value}</Text>
              </div>
            ))}
          </SimpleGrid>

          <Title order={5}>{t('shooting_history')}</Title>
          {history.length === 0 ? (
            <Text c="dimmed">{t('no_shooting_history')}</Text>
          ) : (
            <ScrollArea.Autosize mah={320} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('label_checked_out_at')}</Table.Th>
                    <Table.Th>{t('field_weapon')}</Table.Th>
                    <Table.Th>{t('label_checked_in_at')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>{fmtDateTime(c.checkedOutAt)}</Table.Td>
                      <Table.Td>
                        {weaponLabel(
                          c.weaponBrand,
                          c.weaponModel,
                          c.weaponCaliber,
                          c.weaponDisplayId,
                          c.weaponActive,
                          t,
                        )}
                      </Table.Td>
                      <Table.Td>
                        {c.checkedInAt ? fmtDateTime(c.checkedInAt) : t('status_out')}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Create `src/WeaponInfoModal.tsx`**

```tsx
import {
  Modal,
  Stack,
  Title,
  Badge,
  Table,
  Text,
  SimpleGrid,
  ScrollArea,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { getWeapon, listCheckouts, listWeaponService } from './api';
import { userLabel, weaponLabel } from './labels';
import { fmtDateTime } from './format';

// Read-only weapon view: fields + usage history + service log. Launched from
// the open-loans list and log rows.
export function WeaponInfoModal({
  uid,
  opened,
  onClose,
}: {
  uid: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enabled = opened && uid != null;

  const weaponQ = useQuery({
    queryKey: ['weapon', uid],
    queryFn: () => getWeapon(uid!),
    enabled,
  });
  const historyQ = useQuery({
    queryKey: ['checkouts', { weaponUid: uid }],
    queryFn: () => listCheckouts({ weaponUid: uid }),
    enabled,
  });
  const serviceQ = useQuery({
    queryKey: ['service', uid],
    queryFn: () => listWeaponService(uid!),
    enabled,
  });

  const w = weaponQ.data;

  const info: [string, ReactNode][] = w
    ? [
        [t('field_display_id'), w.displayId ?? '—'],
        [t('field_brand'), w.brand ?? '—'],
        [t('field_model'), w.model ?? '—'],
        [t('field_caliber'), w.caliber ?? '—'],
        [t('field_serial'), w.serial ?? '—'],
        [
          t('status'),
          <>
            <Badge color={w.active ? 'teal' : 'gray'} variant="light">
              {w.active ? t('active') : t('inactive')}
            </Badge>
            {!w.active && w.inactiveReason && (
              <Text size="xs" c="dimmed">
                {w.inactiveReason}
              </Text>
            )}
          </>,
        ],
        [t('field_notes'), w.notes ?? '—'],
      ]
    : [];

  const history = historyQ.data ?? [];
  const service = serviceQ.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        w ? weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t) : ''
      }
      size="xl"
      centered
    >
      {w && (
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="sm">
            {info.map(([label, value]) => (
              <div key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text component="div">{value}</Text>
              </div>
            ))}
          </SimpleGrid>

          <Title order={5}>{t('usage_history')}</Title>
          {history.length === 0 ? (
            <Text c="dimmed">{t('no_shooting_history')}</Text>
          ) : (
            <ScrollArea.Autosize mah={240} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('label_checked_out_at')}</Table.Th>
                    <Table.Th>{t('field_member')}</Table.Th>
                    <Table.Th>{t('label_checked_in_at')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>{fmtDateTime(c.checkedOutAt)}</Table.Td>
                      <Table.Td>
                        {userLabel(c.userName, c.userDisplayId, c.userActive, t)}
                      </Table.Td>
                      <Table.Td>
                        {c.checkedInAt ? fmtDateTime(c.checkedInAt) : t('status_out')}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}

          <Title order={5}>{t('service')}</Title>
          {service.length === 0 ? (
            <Text c="dimmed">{t('no_service')}</Text>
          ) : (
            <ScrollArea.Autosize mah={240} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('field_serviced_at')}</Table.Th>
                    <Table.Th>{t('field_description')}</Table.Th>
                    <Table.Th>{t('operator')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {service.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td>{fmtDateTime(s.servicedAt)}</Table.Td>
                      <Table.Td>{s.description}</Table.Td>
                      <Table.Td>{s.operatorName}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}
```

(The service-table keys `field_serviced_at`, `field_description`, `no_service`, `service` all exist from M5 — verified at i18n.ts:163-170. Reuse them; add no duplicates.)

- [ ] **Step 3: i18n keys**

In `src/i18n.ts`, both blocks. Add near `shooting_history`:

```ts
      usage_history: 'Användningshistorik',
```
```ts
      usage_history: 'Usage history',
```

Delete `back` from both blocks (sv `back: 'Tillbaka',`, en `back: 'Back',`) — MemberDetailPage was its only consumer. Keep `err_user_not_found` (it translates a backend error code via `errors.ts`).

- [ ] **Step 4: Rewire `src/MembersPage.tsx`**

- Remove `import { useNavigate } from 'react-router-dom';` (line 25) and `const navigate = useNavigate();` (line 74).
- Add `import { MemberInfoModal } from './MemberInfoModal';` next to the other component imports.
- Add state next to `debtUser` (line 77): `const [infoUid, setInfoUid] = useState<number | null>(null);`
- Row click (line 272): `onClick={() => setInfoUid(u.uid)}`
- Mount the modal next to `DebtModal` (after line 518):

```tsx
      <MemberInfoModal
        uid={infoUid}
        opened={infoUid != null}
        onClose={() => setInfoUid(null)}
      />
```

- [ ] **Step 5: Drop the route and page**

In `src/App.tsx`: delete line 18 (`import { MemberDetailPage } …`) and line 47 (`<Route path="members/:uid" …/>`).

```bash
git rm src/MemberDetailPage.tsx
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: exit 0. `grep -rn "MemberDetailPage\|t('back')" src/` — no matches.

- [ ] **Step 7: Commit**

```bash
git add -A src/
git commit -m "feat(ui): member/weapon info modals replace member detail page"
```

---

### Task 9: Launch info modals from open-loans rows and log rows

**Files:**
- Modify: `src/CheckoutPage.tsx`
- Modify: `src/LogsPage.tsx`

**Interfaces:**
- Consumes: `MemberInfoModal` / `WeaponInfoModal` from Task 8 (`{ uid, opened, onClose }`).
- Produces: nothing other tasks rely on.

- [ ] **Step 1: CheckoutPage — clickable names in open-loans rows**

Add imports:

```ts
import { MemberInfoModal } from './MemberInfoModal';
import { WeaponInfoModal } from './WeaponInfoModal';
```

Add state next to `debtUser`:

```ts
  const [infoMember, setInfoMember] = useState<number | null>(null);
  const [infoWeapon, setInfoWeapon] = useState<number | null>(null);
```

In the open-loans row (lines 364-374), make the two name texts clickable:

```tsx
                  <Stack gap={2}>
                    <Text
                      fw={600}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setInfoWeapon(o.weaponUid)}
                    >
                      {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, o.weaponDisplayId, o.weaponActive, t)}
                    </Text>
                    <Text
                      size="sm"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setInfoMember(o.userUid)}
                    >
                      {userLabel(o.userName, o.userDisplayId, o.userActive, t)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t('label_checked_out_at')}: {fmtDateTime(o.checkedOutAt)}
                    </Text>
                  </Stack>
```

Mount modals next to `DebtModal` (after line 442):

```tsx
      <MemberInfoModal
        uid={infoMember}
        opened={infoMember != null}
        onClose={() => setInfoMember(null)}
      />
      <WeaponInfoModal
        uid={infoWeapon}
        opened={infoWeapon != null}
        onClose={() => setInfoWeapon(null)}
      />
```

- [ ] **Step 2: LogsPage — clickable weapon/member cells**

Add the same two imports and the same two `useState` lines (import `useState` is already there).

Change the two cells in the row map (lines 79-82):

```tsx
      <Table.Td style={{ cursor: 'pointer' }} onClick={() => setInfoWeapon(c.weaponUid)}>
        {weaponLabel(c.weaponBrand, c.weaponModel, c.weaponCaliber, c.weaponDisplayId, c.weaponActive, t)}
      </Table.Td>
      <Table.Td style={{ cursor: 'pointer' }} onClick={() => setInfoMember(c.userUid)}>
        {userLabel(c.userName, c.userDisplayId, c.userActive, t)}
      </Table.Td>
```

Mount both modals at the end of the page's root `<Stack>` (before the closing tag), same JSX as Step 1's mount block.

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/CheckoutPage.tsx src/LogsPage.tsx
git commit -m "feat(ui): open member/weapon info modals from open-loans and log rows"
```

---

### Task 10: Scrollable lists with sticky headers (Members / Weapons / Logs)

**Files:**
- Modify: `src/MembersPage.tsx` (line 347)
- Modify: `src/WeaponsPage.tsx` (line 310)
- Modify: `src/LogsPage.tsx` (line 159)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: MembersPage**

```tsx
            {/* ponytail: offset ≈ shell header + title + filters — tune at live-smoke if clipped. */}
            <Table.ScrollContainer minWidth={700} maxHeight="calc(100vh - 260px)">
              <Table striped highlightOnHover stickyHeader>
```

- [ ] **Step 2: WeaponsPage**

```tsx
            {/* ponytail: offset ≈ shell header + title + filters — tune at live-smoke if clipped. */}
            <Table.ScrollContainer minWidth={700} maxHeight="calc(100vh - 260px)">
              <Table striped highlightOnHover stickyHeader>
```

- [ ] **Step 3: LogsPage**

The filter row is taller (labels + inputs), so a bigger offset:

```tsx
        {/* ponytail: offset ≈ shell header + title + filter row — tune at live-smoke if clipped. */}
        <Table.ScrollContainer minWidth={900} maxHeight="calc(100vh - 300px)">
          <Table striped highlightOnHover stickyHeader>
```

Known caveat: if at live-smoke the sticky header does not stick inside the scroll-area container, add `type="native"` to `Table.ScrollContainer` (documented fallback; sticky positioning needs the scrollport to be the direct scroll container).

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/MembersPage.tsx src/WeaponsPage.tsx src/LogsPage.tsx
git commit -m "ui: inner-scroll member/weapon/log lists with sticky headers"
```

---

### Task 11: Full verification + docs sync

**Files:**
- Modify: `CLAUDE.md` (file map + status)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: branch ready for user live-smoke.

- [ ] **Step 1: Run everything**

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both green.

- [ ] **Step 2: Orphan sweep**

```bash
grep -rn "suggestedUser\|fresherUser\|banner_fresher\|banner_favorite_out\|banner_suggested\|banner_debt\|banner_weapon_is_favorite\|MemberDetailPage" src/ src-tauri/src/
```

Expected: no matches.

- [ ] **Step 3: Update `CLAUDE.md` file map**

In the "File map" section:
- Remove `MemberDetailPage.tsx (read-only info grid + shooting history)` entry; the `members/:uid` route no longer exists.
- Change the `MembersPage.tsx` description: `row → detail` becomes `row → info modal`.
- Add: `MemberInfoModal.tsx` / `WeaponInfoModal.tsx` (read-only info + history modals, launched from lists/logs/open-loans), `global.css` (app-wide user-select off).
- In `CheckoutPage.tsx` description, note member-first flow (weapon picker disabled until member chosen).
- In "Status", append to the picker-modals line: `+ UX refinements wave (2026-07-14): member-first checkout, info modals, inner-scroll lists`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): file map + status for UX refinements"
```

- [ ] **Step 5: Hand to user for live-smoke**

Ask the user to run `npm run tauri dev` and check:
1. No text selectable anywhere except typing in inputs.
2. Members/Weapons/Logs: filters fixed, list scrolls, column headers stick.
3. Members row → member info modal (no navigation). Open-loans + Logs: weapon/member names open the right modals.
4. Checkout: weapon button disabled until member picked; picking a member autofills or clears the weapon; no clear (×) buttons.
5. Member picker: order stable for members already checked out today; red debt badges right-aligned.
6. Weapon picker: out weapons greyed with "Utlånad till …", favorite ★ still pinned on top.
7. Open-loans debt icon: filled red only for members with outstanding debt.
