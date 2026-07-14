# UX Refinements — Checkout, Members, Weapons, Logs

Date: 2026-07-14
Status: approved

Batch of ten UX refinements. Single feature branch, one implementation plan.

## 1. Scrollable lists with fixed filters (Members / Weapons / Logs)

Filters/search `Group` stays above the scroll region; the existing
`Table.ScrollContainer` gets `maxHeight="calc(100vh - Npx)"` (its documented prop —
it uses ScrollArea internally, no extra wrapper needed) and the table gets Mantine
`stickyHeader` so column headers stay visible while rows scroll. `N` is a per-page
magic offset, tuned at live-smoke, marked with a `ponytail:` comment (same as
CheckoutPage.tsx:358). Fallback if sticky misbehaves inside the scroll-area
container: `type="native"` on `Table.ScrollContainer`.

Files: `MembersPage.tsx`, `WeaponsPage.tsx`, `LogsPage.tsx`.

Rejected alternative: flex-column layout via `AppShell.Main` fixed height — no magic
numbers but touches `AppLayout.tsx` and risks regressing every page including checkout.

## 2. Disable text selection app-wide

New `src/global.css`, imported in `main.tsx`:

```css
* { -webkit-user-select: none; user-select: none; }
input, textarea { -webkit-user-select: text; user-select: text; }
```

`App.css` is dead (never imported) — leave untouched.

## 3. Member info modal + weapon info modal

- **`MemberInfoModal.tsx`** — content of `MemberDetailPage` (info grid: email, phone,
  address, ssn, preferred weapon, status badge, notes + shooting-history table) moves
  into a modal taking `uid` + `opened/onClose`. `MemberDetailPage.tsx` and the
  `/members/:uid` route are deleted.
- **`WeaponInfoModal.tsx`** (new) — field grid (brand, model, caliber, serial, tag,
  status, notes) + checkout history (who/when via `listCheckouts({weaponUid})`) +
  service log (existing service-log query).
- **Launch points** (local `infoUid` state per page, no global store):
  - MembersPage row click → member modal (replaces `navigate`).
  - Checkout open-loans rows: member name click → member modal; weapon name click →
    weapon modal.
  - LogsPage rows: member cell → member modal; weapon cell → weapon modal.

WeaponsPage rows unchanged (not requested).

## 4. Member-first checkout (remove weapon-first)

- Weapon picker button disabled until a member is chosen; helper text
  "choose member first" (i18n sv+en).
- Delete the weapon-first path:
  - Frontend: `onWeaponChange` user-autofill, `banner_suggested_user_busy` alert,
    related i18n keys.
  - Backend: `suggested_user_uid/name/display_id/active` and `suggested_user_busy`
    fields from `CheckoutEval` (checkout.rs), their computation, and their tests.
    TS mirror in `api.ts` updated.

## 5. Weapon follows member change; no manual clear

- `onMemberChange`: always `weaponUid = suggestion ?? null`. (Today a stale weapon
  survives when the new member has no available suggestion.)
- Both `CloseButton`s (member + weapon clear) deleted, along with the
  `clear_selection` usage on CheckoutPage (key kept if used elsewhere, e.g.
  MembersPage preferred-weapon clear).

## 6. Member sort: last shooting day before today

`last_shot_dates` (logs.rs) returns per member both:

- `last`: `MAX(checked_out_at)` (unchanged semantics), and
- `last_before_today`: `MAX(checked_out_at)` over rows where
  `date(checked_out_at, 'localtime') < date('now', 'localtime')`.

MemberPickerModal sorts by `last_before_today` (desc, never-shot last, then name
sv-collation — same tiebreak chain as today, exact-tag match still first) but
**displays** the true `last` date, so the operator still sees "shot today" while
ordering stays stable through the day. TS type + `api.ts` updated.

Note: `checked_out_at` is UTC RFC3339 with `Z`; SQLite `date(x, 'localtime')` parses
this format.

## 7 + 9. In-use warnings move into the weapon picker

- WeaponPickerModal (checkout mode) now **shows** checked-out weapons instead of
  filtering them out: greyed, unclickable, with line "out — held by {name}" (holder
  resolved from already-fetched `listOpenCheckouts` + users map; i18n sv+en).
  Favorite ★ / last badges remain visible on them, so "your favorite / last-used is
  in use by X" is self-evident in the list. Sort order unchanged; disabled rows stay
  in place.
- CheckoutPage banners deleted (info now lives in the picker): `banner_fresher`,
  `banner_weapon_is_favorite`, `banner_favorite_out`, `banner_suggested_weapon_out`,
  plus their frontend derivations (`favoriteOut`, `weaponFavoriteNote`) and i18n keys.
- Banners kept (hard errors / race guards, still enforced by backend `evaluate`):
  `banner_weapon_inactive`, `banner_weapon_already_out` (holder name already
  included), `banner_user_inactive`.

## 8. Debt display

- `banner_debt` deleted from CheckoutPage (backend `user_outstanding_debt_kr` field
  stays — cheap, and DebtModal flows still use debt data elsewhere).
- MemberPickerModal rows: right-aligned red badge with amount (kr) when the member
  owes; data from existing `outstandingDebts()` query.
- Checkout open-loans debt button: `variant="filled"` red when the member owes,
  `variant="subtle"` grey otherwise; always clickable (adding a first debt must stay
  possible). CheckoutPage fetches the same `outstandingDebts()` map (invalidated on
  DebtModal mutations — existing invalidation covers it).

## Testing

- Cargo: adjust `evaluate` tests for removed suggested-user fields; new test for
  `last_shot_dates` today-exclusion (row today + row yesterday → `last_before_today`
  = yesterday, `last` = today).
- `npm run build` green.
- UI behavior (scroll offsets, modal launches, picker disabled rows, selection flow):
  user live-smoke in `tauri dev` per project workflow.

## Out of scope

- WeaponsPage row → weapon info modal.
- Any change to fast check-in (IdNumpadModal), backup, settings.
- Seed changes (existing seed already produces debts + open checkouts).
