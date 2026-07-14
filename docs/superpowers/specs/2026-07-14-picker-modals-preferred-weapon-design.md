# Picker modals + preferred weapon — design

Date: 2026-07-14 · Status: approved

## Goal

1. Replace the member/weapon `Select` dropdowns on the checkout page with large
   touch-first selector modals (filterable list of boxes + numpad).
2. Add a "preferred weapon" per member — exclusive (a weapon can be preferred by
   at most one member), auto-selected at checkout, settable from the return list
   and the member edit form.

Scope decisions (confirmed with user):
- Modal selectors on the **checkout page only**; Logs filters etc. keep dropdowns.
- Preferred weapon settable via **return-list star button AND member detail/edit**.
- Checkout autofill: **preferred weapon first, else last-used** (current behavior).

## 1. Picker modals (frontend)

Two self-contained components sharing an extracted `Numpad` and the same layout:

- **`WeaponPickerModal`** — props: `opened`, `onClose`, `onSelect(uid)`, optional
  `pinned: { preferredUid?: number; lastUid?: number }`, `availableOnly: boolean`.
  Owns its `listWeapons` query. Filters (right column): numpad (tag prefix),
  free-text (brand/model), caliber `Select`, brand `Select` (distinct values from
  data). List (left, ~60%, scrollable): touch-size boxes showing
  `brand model, caliber [tag]` + serial line. Badges: ★ preferred, "last".
  Sort: preferred → last-used → rest by brand/model.
- **`MemberPickerModal`** — same layout. Filters: numpad (tag prefix) + free-text
  name. Boxes: `name [tag]`.
- **`Numpad`** — grid + value display extracted from `IdNumpadModal`; that modal
  keeps using it, so fast check-in is unchanged.

Checkout page changes:
- Both `Select`s become button-style inputs showing the current label
  (placeholder when empty); tap opens the picker; small X clears.
- Per-field ⌨ numpad buttons removed (numpad lives inside the pickers).
- Selection flows through existing `onWeaponChange`/`onMemberChange` so
  autofill + eval banners behave exactly as today.
- Weapon picker from checkout offers available weapons only (active, not out) —
  same pool as today's dropdown; member picker offers active members.

## 2. Preferred weapon — backend

Migration **0003** (append to `migrations()`, never edit 0001/0002):

```sql
ALTER TABLE users ADD COLUMN preferred_weapon_uid INTEGER REFERENCES weapons(uid);
CREATE UNIQUE INDEX idx_users_preferred_weapon
  ON users(preferred_weapon_uid) WHERE preferred_weapon_uid IS NOT NULL;
```

Single column = one preferred weapon per member; partial unique index = one
member per weapon (DB-enforced).

- `models.rs`: `User.preferred_weapon_uid: Option<i64>` (serde camelCase →
  frontend gets it from `listUsers` for free). Not part of `NewUser`/`UpdateUser`.
- `commands.rs`: `set_preferred_weapon(conn, user_uid, weapon_uid: Option<i64>)`
  — user must exist; when `Some`, weapon must exist and be active; unique
  violation mapped to new `AppError::weapon_already_preferred { name }` (name of
  the member who already prefers it). Thin `#[tauri::command]` wrapper,
  registered in `lib.rs`.
- `checkout.rs` `evaluate`: member picked + no weapon → suggest **preferred**
  weapon when it is active and not out; otherwise fall back to the existing
  most-recent-weapon suggestion (with its existing `suggested_weapon_out`
  flagging). All other eval logic unchanged.
- `error.rs` + `src/errors.ts` + i18n: new code `weapon_already_preferred`.

## 3. Weapon list ordering (checkout picker)

Both must pin, and after change 2 `suggestedWeaponUid` = preferred-or-last, so
the last-used uid needs its own field: `CheckoutEval` gains
`last_weapon_uid: Option<i64>` (member's most recent weapon, set whenever a
member is picked and no weapon is). Pin logic in the picker: ★ on the selected
member's `preferredWeaponUid` (users query); "last" badge on
`eval.lastWeaponUid` (cached `['eval', null, userUid]` query) when it differs
from preferred.

## 4. Return-list favorite button

Star `ActionIcon` per open-checkout row, driven by the already-loaded users list:

- Nobody prefers the weapon → outline star; tap →
  `set_preferred_weapon(borrowerUid, weaponUid)` (replaces borrower's previous
  preference).
- Borrower already prefers it → filled star; tap unsets (`weapon_uid = null`).
- Another member prefers it → no button.
- Mutation invalidates `['users']` (+ `['eval']`).

## 5. Member detail / edit

- MembersPage edit modal: "Preferred weapon" button-input opening
  `WeaponPickerModal` (all active weapons, no pin), clearable. Saved via
  `set_preferred_weapon` after the user create/update succeeds, only when changed.
- MemberDetailPage info grid: shows preferred weapon label (resolved from
  weapons query).

## 6. Cross-cutting

- i18n sv+en: picker titles, filter labels, badges (preferred/last), favorite
  tooltips, error message.
- `seed.rs`: assign a few preferred weapons.
- Cargo tests: set/replace/clear preference; exclusivity error; inactive weapon
  rejected; eval prefers preferred; falls back to last-used when preferred
  inactive/out.
- Done = `npm run build` + `cargo test` green + user live-smoke in `tauri dev`.

## Error handling

- `weapon_already_preferred` surfaces via existing `errorMessage` notification
  path with the competing member's name.
- Race between two operators is impossible (single operator per device, single
  `Mutex<Connection>`); DB index is the backstop regardless.

## Out of scope

- Logs-page filter dropdowns, fast check-in flow, any snapshotting of preference
  history (users table column is current-state, not a log).
