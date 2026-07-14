# Checkout Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picker info/ordering polish, two new non-blocking checkout warnings, numpad polish — live-smoke feedback round on the picker/preferred-weapon feature.

**Architecture:** One new read-only backend command (`last_weapon_users`); everything else is frontend composition over already-loaded queries. Blocking rules untouched.

**Tech Stack:** Tauri 2 (Rust/rusqlite) · React + TS + Mantine v9 · TanStack Query · react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-14-checkout-refinements-design.md`
**Branch:** `feat/picker-modals-preferred-weapon` (continues unmerged branch).

## Global Constraints

- All DB access through Rust `#[tauri::command]`s; new command registered in `lib.rs` `generate_handler![]`. Blocking/business rules stay in Rust; the two new warnings are display-only client composition (deliberate).
- i18n: every new user-facing string in BOTH `sv` and `en` objects in `src/i18n.ts` (flat keys, `{{param}}` interpolation).
- React `onChange`: `e.target`, never `e.currentTarget`.
- Mantine v9: plan JSX is a starting point — if a prop doesn't exist in v9, use the v9 equivalent and note it.
- No new npm dependencies.
- Verify: `cargo test --manifest-path src-tauri/Cargo.toml` (backend tasks) and `npm run build` (all tasks) green before commit. No frontend test framework.
- Commit after each task on the feature branch.

---

### Task 1: `last_weapon_users` command

**Files:**
- Modify: `src-tauri/src/logs.rs` (after `last_shot_dates`, ~line 151; tests)
- Modify: `src-tauri/src/lib.rs` (`generate_handler![]`, after `logs::last_shot_dates`)
- Modify: `src/api.ts` (after `lastShotDates`, ~line 204)

**Interfaces:**
- Consumes: existing `checkouts`/`users` tables, `lock` helper in logs.rs.
- Produces: command `last_weapon_users` → `Vec<WeaponLastUse>` (camelCase: `weaponUid`, `userUid`, `userName`, `userDisplayId`, `userActive`, `lastUsedAt`); api.ts `lastWeaponUsers(): Promise<WeaponLastUse[]>` + `interface WeaponLastUse`. Task 4 consumes these exact names.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/logs.rs` tests module (imports already include `do_checkin`, `do_checkout`):

```rust
    #[test]
    fn last_weapon_users_returns_latest_user_per_weapon() {
        let conn = migrated_in_memory();
        let op = mk_user(&conn, "Op", true);
        let anna = mk_user(&conn, "Anna", false);
        let bjorn = mk_user(&conn, "Björn", false);
        let w1 = mk_weapon(&conn, "W1");
        let _unused = mk_weapon(&conn, "W2"); // no history → absent

        // Anna then Björn on W1 — Björn is the latest (same timestamps possible;
        // id DESC tiebreak must pick the later row).
        let c1 = do_checkout(&conn, w1, anna, op, None).unwrap();
        do_checkin(&conn, c1.id, op).unwrap();
        let c2 = do_checkout(&conn, w1, bjorn, op, None).unwrap();

        let rows = last_weapon_users_q(&conn).unwrap();
        assert_eq!(rows.len(), 1); // only W1 has history
        assert_eq!(rows[0].weapon_uid, w1);
        assert_eq!(rows[0].user_uid, bjorn);
        assert_eq!(rows[0].user_name.as_deref(), Some("Björn"));
        assert!(rows[0].user_active);
        assert_eq!(rows[0].last_used_at, c2.checked_out_at);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml last_weapon_users`
Expected: FAIL to compile — `last_weapon_users_q` not found.

- [ ] **Step 3: Implement in `logs.rs`**

After the `last_shot_dates` command (~line 151), add:

```rust
/// Most recent user per weapon (latest checkout row; `checked_out_at DESC,
/// id DESC` tiebreak — same ordering as `checkout::most_recent_checkout`).
/// Identity resolved live by uid. Weapons with no history are absent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponLastUse {
    pub weapon_uid: i64,
    pub user_uid: i64,
    pub user_name: Option<String>,
    pub user_display_id: Option<String>,
    pub user_active: bool,
    pub last_used_at: String,
}

fn last_weapon_users_q(conn: &Connection) -> Result<Vec<WeaponLastUse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.weapon_uid, c.user_uid, u.name, u.display_id, u.active, c.checked_out_at
         FROM checkouts c
         JOIN users u ON u.uid = c.user_uid
         WHERE c.id = (SELECT c2.id FROM checkouts c2 WHERE c2.weapon_uid = c.weapon_uid
                       ORDER BY c2.checked_out_at DESC, c2.id DESC LIMIT 1)",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WeaponLastUse {
            weapon_uid: r.get(0)?,
            user_uid: r.get(1)?,
            user_name: r.get(2)?,
            user_display_id: r.get(3)?,
            user_active: r.get(4)?,
            last_used_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[tauri::command]
pub fn last_weapon_users(db: State<Db>) -> Result<Vec<WeaponLastUse>, AppError> {
    let conn = lock(&db)?;
    last_weapon_users_q(&conn)
}
```

In `lib.rs` `generate_handler![]`, after `logs::last_shot_dates,` add:

```rust
            logs::last_weapon_users,
```

- [ ] **Step 4: api.ts wrapper**

In `src/api.ts`, after the `lastShotDates` wrapper (~line 204), add:

```ts
export interface WeaponLastUse {
  weaponUid: number;
  userUid: number;
  userName: string | null;
  userDisplayId: string | null;
  userActive: boolean;
  lastUsedAt: string;
}

export const lastWeaponUsers = () => invoke<WeaponLastUse[]>('last_weapon_users');
```

- [ ] **Step 5: Run full suite + build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` → PASS (62 tests)
Run: `npm run build` → PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/logs.rs src-tauri/src/lib.rs src/api.ts
git commit -m "feat(logs): last_weapon_users command — latest user per weapon"
```

---

### Task 2: Numpad polish (drop C, placeholder prop, quick-return text)

**Files:**
- Modify: `src/Numpad.tsx`
- Modify: `src/IdNumpadModal.tsx`
- Modify: `src/CheckoutPage.tsx` (fast check-in `IdNumpadModal` mount, ~line 420)
- Modify: `src/i18n.ts` (both languages)

**Interfaces:**
- Consumes: existing components.
- Produces: `Numpad({ value, onChange, size?, placeholder? })`; `IdNumpadModal` gains optional `placeholder?: string` passed through. Picker modals (which don't pass it) keep the `enter_id` default.

- [ ] **Step 1: i18n keys**

`sv`: `enter_weapon_id: 'Ange vapen-ID',` — `en`: `enter_weapon_id: 'Enter weapon ID',` (place next to `enter_id` in each object).

- [ ] **Step 2: Numpad changes**

In `src/Numpad.tsx`: replace the `KEYS` const, add the prop, render the empty slot invisibly:

```tsx
// '' is a spacer where C used to sit — keeps 0 centered; ⌫ covers clearing.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function Numpad({
  value,
  onChange,
  size = 'xl',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  size?: 'md' | 'xl';
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const press = (k: string) => {
    if (k === '⌫') onChange(value.slice(0, -1));
    else onChange(value + k);
  };
```

`TextInput` placeholder becomes `placeholder={placeholder ?? t('enter_id')}`. The grid map renders the spacer invisibly:

```tsx
        {KEYS.map((k) =>
          k === '' ? (
            // single spacer — key must not collide with the '9' button key
            <span key="spacer" />
          ) : (
            <Button key={k} variant="default" size={size} onClick={() => press(k)}>
              {k}
            </Button>
          ),
        )}
```

- [ ] **Step 3: IdNumpadModal passthrough**

Add `placeholder?: string;` to the props interface and parameter list, pass `placeholder={placeholder}` to `<Numpad>`.

- [ ] **Step 4: Fast check-in uses it**

In `src/CheckoutPage.tsx`, the fast check-in `<IdNumpadModal ... />` (~line 420) gains:

```tsx
        placeholder={t('enter_weapon_id')}
```

- [ ] **Step 5: Build + commit**

Run: `npm run build` → PASS

```bash
git add src/Numpad.tsx src/IdNumpadModal.tsx src/CheckoutPage.tsx src/i18n.ts
git commit -m "feat(numpad): drop C key, per-instance placeholder, quick-return weapon-ID text"
```

---

### Task 3: Member picker — last shot date + sort

**Files:**
- Modify: `src/MemberPickerModal.tsx`

**Interfaces:**
- Consumes: `lastShotDates` + `type User` from `./api`; `fmtDate` from `./format`.
- Produces: UI only.

- [ ] **Step 1: Implement**

In `src/MemberPickerModal.tsx`:

Imports: add `lastShotDates, type User` to the `./api` import; add `import { fmtDate } from './format';`.

After the `users` query add:

```tsx
  const shots = useQuery({ queryKey: ['lastShotDates'], queryFn: lastShotDates, enabled: opened });
  const lastMap = new Map((shots.data ?? []).map((s) => [s.userUid, s.lastShotAt] as const));
```

Replace the `sorted` line with (exact tag match → last shot desc, never-shot last → name sv):

```tsx
  const rank = (u: User) => (tag && u.displayId === tag ? 0 : 1);
  const sorted = [...filtered].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const av = lastMap.get(a.uid);
    const bv = lastMap.get(b.uid);
    if (av !== bv) {
      if (!av) return 1;
      if (!bv) return -1;
      return bv.localeCompare(av); // most recent first
    }
    return a.name.localeCompare(b.name, 'sv');
  });
```

In the box, replace the phone line with the last shot date:

```tsx
                    {lastMap.has(u.uid) && (
                      <Text size="xs" c="dimmed">
                        {t('field_last_shot')}: {fmtDate(lastMap.get(u.uid)!)}
                      </Text>
                    )}
```

(`field_last_shot` already exists in both languages — reused from MembersPage.)

- [ ] **Step 2: Build + commit**

Run: `npm run build` → PASS

```bash
git add src/MemberPickerModal.tsx
git commit -m "feat(member-picker): sort by last shot then name, exact tag match first, show last shot date"
```

---

### Task 4: Weapon picker — last user line + favorite badge + sort

**Files:**
- Modify: `src/WeaponPickerModal.tsx`
- Modify: `src/i18n.ts` (both languages)

**Interfaces:**
- Consumes: `lastWeaponUsers`, `WeaponLastUse`, `listUsers` from `./api` (Task 1); `userLabel` from `./labels`; `fmtDate` from `./format`.
- Produces: UI only.

- [ ] **Step 1: i18n key**

`sv`: `picker_last_used: 'Senast: {{name}} · {{date}}',` — `en`: `picker_last_used: 'Last: {{name}} · {{date}}',`.

- [ ] **Step 2: Implement**

In `src/WeaponPickerModal.tsx`:

Imports: extend the `./api` import with `listUsers, lastWeaponUsers`; add `userLabel` to the `./labels` import; add `import { fmtDate } from './format';`.

After the `open` query add:

```tsx
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const lastUses = useQuery({
    queryKey: ['lastWeaponUsers'],
    queryFn: lastWeaponUsers,
    enabled: opened,
  });
  const lastUseMap = new Map((lastUses.data ?? []).map((l) => [l.weaponUid, l] as const));
  // weapon uid → the member whose favorite it is (at most one; DB-enforced).
  const preferrerMap = new Map(
    (users.data ?? [])
      .filter((u) => u.preferredWeaponUid != null)
      .map((u) => [u.preferredWeaponUid as number, u] as const),
  );
```

Replace the `rank` function (exact tag match beats pins):

```tsx
  const rank = (w: Weapon) =>
    tag && w.displayId === tag
      ? 0
      : w.uid === pinned?.preferredUid
        ? 1
        : w.uid === pinned?.lastUid
          ? 2
          : 3;
```

Replace the box body (the inner `<Group justify="space-between" ...>` content). Serial line stays; a last-used line is added; badges become a `Group` where the favorite badge (own = `★ Favorit`, someone else's = `★ <name>`) and the `Senast`/last badge can coexist:

```tsx
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{label(w)}</Text>
                      {w.serial && (
                        <Text size="xs" c="dimmed">
                          {w.serial}
                        </Text>
                      )}
                      {lastUseMap.has(w.uid) && (
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
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → PASS

```bash
git add src/WeaponPickerModal.tsx src/i18n.ts
git commit -m "feat(weapon-picker): last-user line, favorite-owner badge, exact tag match first"
```

---

### Task 5: Two new checkout warnings

**Files:**
- Modify: `src/CheckoutPage.tsx`
- Modify: `src/i18n.ts` (both languages)

**Interfaces:**
- Consumes: existing `users`/`weapons`/`open` queries, `preferrerOf` helper, `selectedUser`, `weaponLabel`/`userLabel`.
- Produces: UI only. Non-blocking — `canCheckout`/`confirm` untouched.

- [ ] **Step 1: i18n keys**

`sv`:

```ts
    banner_favorite_out: '{{member}}s favoritvapen ({{weapon}}) är utlånat till {{holder}}',
    banner_weapon_is_favorite: 'Vapnet är {{name}}s favoritvapen',
```

`en`:

```ts
    banner_favorite_out: "{{member}}'s favorite weapon ({{weapon}}) is out with {{holder}}",
    banner_weapon_is_favorite: "Weapon is {{name}}'s favorite",
```

- [ ] **Step 2: Compute the two notices**

In `src/CheckoutPage.tsx`, after the `memberDescription` const (~line 169), add:

```tsx
  // Member's favorite weapon is currently out — informational, shown whenever
  // the member is selected (autofill already fell back to last-used).
  const favoriteOut = (() => {
    const prefUid = selectedUser?.preferredWeaponUid;
    if (prefUid == null) return null;
    const o = (open.data ?? []).find((x) => x.weaponUid === prefUid);
    if (!o) return null;
    const w = (weapons.data ?? []).find((x) => x.uid === prefUid);
    return t('banner_favorite_out', {
      member: selectedUser!.name,
      weapon: w
        ? weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t)
        : '',
      holder: userLabel(o.userName, o.userDisplayId, o.userActive, t),
    });
  })();

  // Chosen weapon is another member's favorite — informational, never blocks.
  const weaponFavoriteNote = (() => {
    if (weaponUid == null) return undefined;
    const p = preferrerOf(weaponUid);
    if (!p || p.uid === userUid) return undefined;
    return t('banner_weapon_is_favorite', { name: p.name });
  })();
```

- [ ] **Step 3: Render**

Under the weapon field, next to the existing description/error lines (~line 264):

```tsx
            {weaponFavoriteNote && <Text fz="xs" c="orange.7">{weaponFavoriteNote}</Text>}
```

(placed alongside `weaponDescription` — both may show.)

With the two existing Alerts (~line 293), add:

```tsx
          {favoriteOut && <Alert color="orange">{favoriteOut}</Alert>}
```

- [ ] **Step 4: Build + commit**

Run: `npm run build` → PASS

```bash
git add src/CheckoutPage.tsx src/i18n.ts
git commit -m "feat(checkout): warn on favorite-weapon-out and another-members-favorite"
```

---

## Verification & handoff (controller)

- Full `cargo test` + `npm run build` after Task 5.
- Final review of the wave, then user live-smoke:
  1. Member picker: order = exact tag match ("4" → member 4 first) → most recent shooter → name; boxes show last shot date.
  2. Weapon picker: last-user line + date; `★ <name>` on other members' favorites; exact tag match first.
  3. Checkout: member with out favorite → orange alert naming weapon + holder; picking another member's favorite → orange note under weapon field.
  4. Numpad: no C key, 0 centered; quick return says "Ange vapen-ID".
