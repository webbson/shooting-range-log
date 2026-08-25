# CLAUDE.md — Shooting Range Log

Project memory for Claude. Merge with the user's global `~/.claude/CLAUDE.md`.

## What this is
Desktop app to manage weapons, members, and weapon checkout/checkin on a shooting
range. Touch-screen Windows laptop, single operator at a time. Dev on Mac, ship Windows.

Spec: `project.md`. Deferred work: `BACKLOG.md`. Session continuity: `primer.md` (gitignored).

## Stack
- **Tauri 2** (Rust core) + **React + TypeScript + Mantine v9** in the WebView.
- **SQLite via rusqlite** (bundled), migrations via **rusqlite_migration** (auto-applied on launch).
- Frontend: **TanStack Query** (server state; `networkMode: 'always'` — Tauri IPC must never
  pause on offline WebView) · **Zustand** (app state) · **react-i18next** (sv + en) ·
  **@mantine/form** · **@mantine/dates** · **@tabler/icons-react** · **dayjs**.

## Commands
- Dev (launches app): `npm run tauri dev`
- Frontend typecheck + bundle: `npm run build`  (must be green before done)
- Backend tests: `cargo test --manifest-path src-tauri/Cargo.toml`  (must be green before done)
- Seed dev DB with mock data (**wipes** then refills): `npm run seed`
- Windows installer: CI only (`release.yml` via tauri-action on `windows-latest`; needs the signing-key secrets) — can't cross-build from Mac.
- Release: `/release patch|minor|major` → tag push → CI (`release.yml`) builds and publishes the installer.

## Architecture rules (do not violate)
- **All DB access goes through Rust `#[tauri::command]`s.** Never add `tauri-plugin-sql`.
- **Validation/business rules live in Rust**, not JS (JS is convenience only).
- **Identity model:** every entity has hidden `uid` (INTEGER PK, the only FK target) +
  movable `display_id` (the physical tag). `display_id` is unique only among **active**
  rows (partial unique index) so a tag is reusable once its holder is retired; it may be
  cleared on deactivation to free the tag. **Weapons** require a tag while active
  (create/update/reactivate enforce it). **Members/users** no longer use the tag at all in
  the UI (removed 2026-07-23, Excel-era leftover) — the DB column and uniqueness rule remain,
  members always render as bare name. `serial` (weapons) is globally
  unique. Durable legal identity = serial via uid. (Members no longer carry a
  `member_number` — column remains in the shipped migration but is unused.) **Guests** are
  ordinary `users` rows flagged `is_guest`, SSN-unique among active users (app-enforced,
  not a DB constraint), created via `upsert_guest` (checkout-time walk-in) and promoted to
  a full member via `promote_guest` (admin-only UI action).
- **Live identity, not snapshots:** because entities are never hard-deleted (only
  `set_active(false)`) and tags are reusable, log read views resolve identity **live by uid**
  via JOIN — history reflects each entity's *current* name/status, not a point-in-time value
  (a snapshotted tag would mis-attribute after reassignment). Display composes
  `name [id]` when active with a tag, bare `name` when active without one, `name [disabled]` when not (`src/labels.ts`); weapons compose
  `brand model, caliber [id]` (caliber omitted when absent) where `[id]` is the **display_id
  (tag)**, not the serial. Log rows store
  **only uids** — there are no `*_snapshot` columns (removed during dev; schema squashed to a
  single migration 0001). Never reintroduce snapshots. Log tables (checkouts,
  weapon_service_log, debts) stay **append-only** — corrections/returns/settles are new rows
  or field updates, never deletes.
- **Migrations:** `SCHEMA_V1` (domain schema) + `SCHEMA_V2` (settings table) + `SCHEMA_V3`
  (`users.preferred_weapon_uid` + partial unique index) + `SCHEMA_V4` (`users.is_guest`/
  `is_admin` + weapons `tag_needs_service`/`tag_broken`/`tag_missing_parts`/
  `tag_needs_cleaning`/`tag_comment`) in `src-tauri/src/db.rs`. Currently 4 migrations
  (0001–0004). Once a migration has shipped to a real install, **never edit it — append a
  new `M::up` (0005, …)** to the `migrations()` vec. Editing a released migration silently
  diverges existing DBs.
- **Preferred weapon:** `users.preferred_weapon_uid` — exclusive both ways (one favorite per
  member; a weapon is at most one member's favorite, DB-enforced by partial unique index).
  Set only via `set_preferred_weapon` (never through create/update user); deactivating a
  member clears it (frees the slot); import sets it from the `vapen` column (first row wins,
  never overwrites a live preference, skips inactive matched members). Checkout autofill
  suggests the assigned (preferred) weapon first whenever it is active — even while
  checked out (selected with the out-warning shown), falling back to last-used only when
  no active assignment exists; a last-used suggestion is not autofilled while out.
  UI copy says "assigned/tilldelat" — code and schema keep the preferred_weapon naming.
- **Money:** integer whole **kronor** (`amount_kr`). No floats, no öre.
- **Time:** store UTC RFC3339; display via `src/format.ts` (sv-SE, e.g. `2026-06-16 14:30`).
- **Operators** are users with `is_staff`. The frontend store holds `{uid, name}`; `uid` is
  recorded as the FK on every logged action (checkout/checkin/service/debt).

## Conventions
- **Backend module pattern:** one module per domain (`commands.rs` entities, `checkout.rs`,
  `debt.rs`, `logs.rs`, `service.rs`). Inner fns take `&Connection` (unit-testable, with
  `db::migrated_in_memory()`); thin `#[tauri::command]` wrappers lock the `Mutex<Connection>`
  state and delegate. Register every command in `lib.rs` `generate_handler!`.
- **Errors:** `AppError { code, message, params }` (`error.rs`). Construct via helpers
  (`AppError::display_id_taken(..)` etc). Frontend translates `code`+`params` through
  `src/errors.ts` `errorMessage(e, t)` into i18n; English `message` is the fallback.
- **i18n:** all user-facing strings keyed in `src/i18n.ts` (both `sv` and `en`); never
  hardcode UI copy. Default language Swedish.
- **Tauri v2 args:** JS passes **camelCase**, Rust receives **snake_case** (auto-converted).
  Struct inputs are wrapped: `invoke('create_user', { input })`.
- **Frontend data:** TanStack Query for all `invoke` calls; mutations `invalidateQueries`
  on success; surface errors via Mantine `notifications` + `errorMessage`.

## Dev data
`src-tauri/src/seed.rs` (run via `npm run seed`) **wipes** the domain tables then refills the
dev DB with a deterministic mock dataset (20 users, 20 weapons, checkouts/checkins incl. open
ones, debts, service logs, plus a few retired entities) by calling the real create fns. The CLI
(`bin/seed.rs`) resolves the same DB path the app uses via `db::dev_db_path` (no Tauri handle).
**Run with the app closed**, then launch — both writing the WAL file at once risks `SQLITE_BUSY`,
and a running app won't show the new data until a refetch/restart anyway.
**Keep it current:** when you add a new entity, field, or log type, extend `seed.rs` so the new
thing is populated and testable too.

## Working workflow (per feature)
Backend module (+ cargo tests) → register in `lib.rs` → frontend (`api.ts` wrapper+types,
page/modal, i18n sv+en) → `npm run build` + `cargo test` green → **user live-smoke in
`tauri dev`** (cargo+build cannot render UI; every milestone has had live-only bugs) →
commit on a `feat/*` branch → merge to `main`.

- Verify Tauri 2 / Mantine v9 / rusqlite APIs via **Context7** before using — don't build on memory.
- Feature branch for non-trivial work; run tests before declaring done.

## File map
- `src-tauri/src/`: `lib.rs` (setup + command registry + `db_health`), `db.rs`
  (connection, `SCHEMA_V1`+`SCHEMA_V2`, migrations, test conn), `error.rs`, `models.rs`
  (User/Weapon + New/Update, serde camelCase), `commands.rs` (entity CRUD + display_id/serial
  rules), `checkout.rs` (evaluate/checkout/checkin/open list), `debt.rs`, `logs.rs`, `service.rs`,
  `stats.rs` (stats/maintenance read queries + 6-kind CSV export: `;`-separated, UTF-8 BOM,
  Swedish headers, local timestamps),
  `settings.rs` (S3/passphrase settings, get/update commands),
  `backup.rs` (snapshot_local via VACUUM INTO, GFS retention, list_local, restore_from_file via rusqlite backup API),
  `crypto.rs` (age passphrase encrypt/decrypt),
  `s3.rs` (rust-s3: test_connection, upload, list_remote, download, delete, retention_remote),
  `seed.rs` (dev mock-data seeding), `bin/seed.rs` (the `npm run seed` CLI entry).
- `src/`: `App.tsx` (providers + routes; `/checkout` remounts on nav click via `location.key`
  → full flow reset), `UpdatePrompt.tsx` (prompt-on-launch updater modal, sv/en),
  `AppLayout.tsx` (shell, footer status bar, operator
  badge, theme + fullscreen toggles, fullscreen-only shutdown button with confirm
  → `close()` so the `ExitRequested` backup snapshot runs), `OperatorPicker.tsx`, `CheckoutPage.tsx` (weapon-first flow: tag-numpad selector
  step with candidate-user radio boxes [assigned default, last-borrower alternative] and
  direct checkout, then a member/weapon form step with assign checkbox + transfer/replace
  confirm popups — no longer hosts the open-loans list, see `CheckinPage.tsx`),
  `CheckinPage.tsx` (the open-loans list: responsive auto-fill columns, teal tag stripe per
  card, check-in/debt/assign/tag actions),
  `GuestModal.tsx` (reusable guests: two-panel 90% touch modal — pick existing / create new,
  shared on-screen keyboard with digit row, focus-routed; SSN identifies via `upsert_guest`),
  `Keyboard.tsx` (on-screen Swedish QWERTY, optional digit row via `withDigits`),
  `TagModal.tsx` (per-weapon condition tags + free comment, no admin gate — technician workflow),
  `useIsAdmin.ts` (UI-only admin gate hook; bootstrap rule disables gating while no active
  admin exists in the DB),
  `Numpad.tsx` (shared keypad) + `IdNumpadModal.tsx` (fast check-in),
  `WeaponPickerModal.tsx` (90% touch picker: tag numpad, brand/caliber + available/unassigned
  filters, teal tag chips, out-weapons sink) / `MemberPickerModal.tsx` (90% touch picker:
  name search + on-screen keyboard, last-shot sort),
  `MemberInfoModal.tsx` / `WeaponInfoModal.tsx` (read-only info + history modals, launched from
  lists/logs/open-loans), `MembersPage.tsx` (list: sortable, last-shot + assigned-weapon
  columns, row → info modal; xl two-column edit modal incl. preferred weapon),
  `WeaponsPage.tsx` (list + create/edit; brand/model/caliber Autocomplete + "base on existing weapon"),
  `weaponPresets.ts` (curated brand/caliber lists + DB-merge suggestion helper),
  `LogsPage.tsx`, `DebtModal.tsx`, `ServiceModal.tsx`,
  `StatsPage.tsx` (Statistik: preset SegmentedControl + ‹ › period navigation to any past
  day/week/month/year, number tiles, dependency-free CSS bar chart with whole-period
  zero-fill, weapon-usage/member-activity/debts tables, CSV exports),
  `MaintenancePage.tsx` (Underhåll: stale assignments with months select 1–12 + confirm-popup
  unassign, never-borrowed weapons, tagged weapons → TagModal, guests by loan count with
  admin-gated promote), `useExportCsv.ts` (save-dialog → `export_csv` hook),
  `api.ts` (invoke wrappers + types),
  `store.ts` (Zustand; `persist` keeps language, fullscreen, last operator uid), `i18n.ts`, `errors.ts`, `format.ts`, `theme.ts`, `global.css` (app-wide
  user-select off).
- `.github/workflows/`: `release.yml`
  (on `v*` tag push: stamps the tag version into `tauri.conf.json`, `tauri-action` builds the
  NSIS installer + updater artifacts/`latest.json`, RC tags marked prerelease).

## Status
M0–M6 done on `main`; all waves through auto-update (2026-07-23) merged and live-smoked.
M7 remaining: Windows code signing — see `BACKLOG.md`.
`origin` = github.com/webbson/shooting-range-log (public).

## Backup architecture (M6)
- **Snapshot:** `VACUUM INTO` every 10 min (timer thread) + on `ExitRequested`. Always local first.
- **Encryption:** `age` crate, passphrase mode (scrypt KDF). Encrypt artifact BEFORE any S3 upload.
- **Retention (GFS, fixed):** today→hourly, this month→daily, this year→weekly, prev year→monthly, older→purge.
- **S3:** `rust-s3`, path-style, S3-compatible endpoint. Upload encrypted `.age` files; list/download/retention on remote.
- **Restore:** rusqlite online backup API (in-place copy into live connection); re-runs migrations after.
- **Keys stored:** passphrase + S3 secret in `settings` table plaintext (same threat model as SSN — BitLocker mitigation).

## Privacy
SSN/personnummer is stored **plaintext** (deliberate). Mitigation is disk encryption
(BitLocker) + encrypting backup artifacts before they leave the device (M6) — not column
encryption. Keep this in mind for backups/export.
