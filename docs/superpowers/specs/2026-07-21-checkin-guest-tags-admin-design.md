# Checkin page split, guest loans, weapon tags, admin level — design

Date: 2026-07-21
Status: approved (brainstormed with user)

## Goal

Four features in one wave:

1. Split the combined checkout/checkin page into two touch-friendly pages, with an
   open-loan count badge on the Checkin nav button.
2. Guest loans: check out weapons to people who are not yet members (name + SSN).
3. Weapon tags/comments (e.g. "needs service") settable at checkin, filterable in the
   weapons list.
4. A second permission level: operators run the day-to-day, admins manage entities and
   settings. Admin-only actions are hidden from non-admin operators. No PIN for now.

## Decisions (user-confirmed)

- Guest = `users` row with `is_guest` flag. Hidden from normal member lists and the
  member picker; created/selected only via a dedicated guest checkout modal. Operators
  may create guests; only admins may promote a guest to a real member. Guests are
  identified by SSN and unique on it.
- Tags = fixed set of four, stored as **columns on `weapons`** (user overrode the
  tags-table alternative): needs service, broken, missing parts, needs cleaning. Plus
  one free-text comment column. No per-tag attribution or history — service history
  already lives in the service log.
- A tagged weapon **warns** in the picker/eval; it does not block checkout.
- Admin = `is_admin` flag on users. No PIN. Admin-only buttons hidden for non-admins.
  Must be bootstrappable on a blank install with zero users.
- UI-only enforcement for admin gating; backend commands unchanged (single-operator
  desktop app, low threat model).
- Guest SSN uniqueness enforced in Rust (app-level check), not by a DB index — existing
  member rows may share or lack SSNs, so a partial unique index could break migration.

## 1. Migration 0004

Append a new `M::up` (0004) to the `migrations()` vec in `src-tauri/src/db.rs`.
Never edit shipped migrations 0001–0003.

```sql
ALTER TABLE users   ADD COLUMN is_guest            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users   ADD COLUMN is_admin            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_needs_service   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_broken          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_missing_parts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_needs_cleaning  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN tag_comment         TEXT;
```

- `models.rs`: `User` gains `is_guest`/`is_admin`; `Weapon` gains the four tag bools +
  `tag_comment` (serde camelCase as usual). `NewUser`/`UpdateUser` and weapon structs
  updated where relevant. `is_guest` is NOT settable through `create_user`/
  `update_user` — guests are created only via `upsert_guest` and cleared only via
  `promote_guest`. `is_admin` IS carried by `UpdateUser` (the admin checkbox in the
  user edit modal maps to `update_user`); the checkbox is hidden from non-admins,
  which is acceptable since gating is UI-level by decision.
- No new tables. No new indexes.

## 2. Page split

- `/checkout` — existing member-first checkout flow only. The open-loans list is
  removed from this page.
- `/checkin` — new `CheckinPage.tsx`:
  - Open-loans list moved here (scrollable, sticky header, big touch rows — same
    component patterns as today).
  - Fast check-in via the existing `IdNumpadModal`.
  - Per-row actions: return, debt (red when owing), favorite-star, and a **new tag
    button** opening the TagModal (section 4).
- Nav (`AppLayout.tsx` `NAV`): add `{ to: '/checkin', key: 'nav_checkin' }` after
  checkout. The Checkin nav button shows a Mantine `Badge` with the open-loan count.
  Count comes from the existing `openCheckouts` query (30 s `refetchInterval` already
  in place); badge hidden when the count is 0. Default route stays `/checkout`.

## 3. Guest loans

- `/checkout` gets a "Guest" button beside the member picker button.
- `GuestModal`: SSN entry (numpad-style, consistent with existing pickers) + name field.
- Backend command `upsert_guest { name, ssn }` → `User`:
  - An active user with that SSN exists and `is_guest` → return that row (name is NOT
    overwritten on repeat visits).
  - An active user with that SSN exists and is a member → `AppError`
    `ssn_belongs_to_member` (frontend message: use normal member checkout).
  - Otherwise create a user with `is_guest = 1`, no `display_id`, and return it.
- After the guest is selected the flow is the normal one: weapon pick → eval →
  checkout with `user_uid` = guest uid. Open loans, debts, logs all work unchanged
  because a guest is a normal `users` row.
- Exclusions:
  - `MemberPickerModal` never shows guests.
  - `MembersPage` hides guests by default. Admins see a "show guests" toggle; guest
    rows get a **Promote** button.
- `promote_guest(uid)` backend command clears `is_guest`. After promotion the row is a
  normal member and is edited through the usual member edit modal.
- Labels (`src/labels.ts`): guests render with a guest suffix — `name (gäst)` /
  `name (guest)` — in open loans and log views. Log read views resolve identity live
  by uid (existing rule), so their JOINs must also select `is_guest`.

## 4. Weapon tags

- Fixed tag set, hardcoded (Rust + i18n sv/en): `needs_service`, `broken`,
  `missing_parts`, `needs_cleaning`. Adding a tag later = one column migration +
  i18n keys.
- `TagModal`: four toggles + comment textarea → backend command
  `set_weapon_tags { weapon_uid, needs_service, broken, missing_parts, needs_cleaning,
  comment }` (four booleans + optional comment) writing the columns. Operators may
  set and clear tags (no admin needed).
- Reachable from: checkin rows, `WeaponsPage` rows, `WeaponInfoModal`.
- `WeaponsPage`: per-row tag badges + filter chips (any-of match). Filtering is
  frontend-only — the full list is already loaded.
- Checkout eval (`checkout.rs`): new warning `weapon_tagged` with the active tag names
  as params when the chosen weapon has any tag set. `WeaponPickerModal` rows show
  small tag badges.
- `seed.rs`: tag a few weapons (incl. comments) and create two guests, one with an
  open loan, so everything is live-smokeable.

## 5. Admin level

- Operator store (`store.ts`) becomes `{ uid, name, isAdmin }`; `OperatorPicker`
  passes `isAdmin` from the selected user row.
- Hidden for non-admin operators:
  - Member create/edit/deactivate (MembersPage buttons + row edit)
  - Weapon create/edit/deactivate (WeaponsPage)
  - Settings gear (footer)
  - Guest promote button
  - The admin checkbox in the user edit form (only admins can grant admin)
- Operators keep: checkout/checkin, guest creation, debts, service, tags.
- **Bootstrap:** `has_admin` backend query (count of active users with `is_admin`).
  When zero, gating is disabled — everything visible — so a blank install can create
  its first user and flag it admin. If `OperatorPicker` currently blocks when zero
  staff users exist, add a skip path for that empty state (verify at implementation).
- Enforcement is UI-only; backend commands are not gated.

## 6. i18n

All new user-facing strings keyed in `src/i18n.ts`, both `sv` and `en`: `nav_checkin`,
guest modal strings, `ssn_belongs_to_member` error, tag names, `weapon_tagged`
warning, promote/show-guests strings, admin checkbox label. Default language Swedish.

## 7. Testing

- Cargo tests (against `db::migrated_in_memory()`): migration 0004 applies; `upsert_guest`
  new / repeat / member-SSN-conflict; `promote_guest`; `set_weapon_tags` set + clear;
  eval `weapon_tagged` warning present/absent; guest excluded from any member list
  queries that filter guests server-side (if any).
- `npm run build` and `cargo test` green before done.
- User live-smoke in `tauri dev` (every milestone has had live-only bugs): page split
  navigation, badge count, guest checkout end-to-end, repeat guest, member-SSN
  conflict, tag set/filter/warning, admin hiding with admin vs non-admin operator,
  blank-install bootstrap (fresh DB).

## Out of scope

- PIN/authentication for admin (future).
- Backend authorization enforcement.
- Editable tag set (admin-managed tags).
- Per-tag comments, attribution, or tag history.
- Guest → member data enrichment beyond the normal edit modal.
