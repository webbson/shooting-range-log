# CLAUDE.md — Shooting Range Log

Project memory for Claude. Merge with the user's global `~/.claude/CLAUDE.md`.

## What this is
Desktop app to manage weapons, members, and weapon checkout/checkin on a shooting
range. Touch-screen Windows laptop, single operator at a time. Dev on Mac, ship Windows.

Spec: `project.md`. Deferred work: `BACKLOG.md`. Session continuity: `primer.md` (gitignored).

## Stack
- **Tauri 2** (Rust core) + **React + TypeScript + Mantine v9** in the WebView.
- **SQLite via rusqlite** (bundled), migrations via **rusqlite_migration** (auto-applied on launch).
- Frontend: **TanStack Query** (server state) · **Zustand** (app state) · **react-i18next**
  (sv + en) · **@mantine/form** · **@mantine/dates** · **dayjs**.

## Commands
- Dev (launches app): `npm run tauri dev`
- Frontend typecheck + bundle: `npm run build`  (must be green before done)
- Backend tests: `cargo test --manifest-path src-tauri/Cargo.toml`  (must be green before done)
- Windows installer: CI only (`npm run tauri build` on `windows-latest`) — can't cross-build from Mac.

## Architecture rules (do not violate)
- **All DB access goes through Rust `#[tauri::command]`s.** Never add `tauri-plugin-sql`.
- **Validation/business rules live in Rust**, not JS (JS is convenience only).
- **Identity model:** every entity has hidden `uid` (INTEGER PK, the only FK target) +
  movable `display_id` (the physical tag). `display_id` is unique only among **active**
  rows (partial unique index) so a tag is reusable once its holder is retired; it is
  **required while active** (create/update/reactivate enforce it), and may be cleared on
  deactivation to free the tag. `serial` (weapons) is globally unique. Durable legal
  identity = serial via uid. (Members no longer carry a `member_number` — column remains in
  the shipped migration but is unused.)
- **Live identity, not snapshots:** because entities are never hard-deleted (only
  `set_active(false)`) and tags are reusable, log read views resolve identity **live by uid**
  via JOIN — history reflects each entity's *current* name/status, not a point-in-time value
  (a snapshotted tag would mis-attribute after reassignment). Display composes
  `name (id)` when active, `name (disabled)` when not (`src/labels.ts`). Log rows store
  **only uids** — there are no `*_snapshot` columns (removed during dev; schema squashed to a
  single migration 0001). Never reintroduce snapshots. Log tables (checkouts,
  weapon_service_log, debts) stay **append-only** — corrections/returns/settles are new rows
  or field updates, never deletes.
- **Migrations:** the full schema is `SCHEMA_V1` in `src-tauri/src/db.rs` — currently the
  **only** migration (0002/0003 were squashed back into it while still dev-only). Once a
  migration has shipped to a real install, **never edit it — append a new `M::up` (0002, …)**
  to the `migrations()` vec. Editing a released migration silently diverges existing DBs.
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

## Working workflow (per feature)
Backend module (+ cargo tests) → register in `lib.rs` → frontend (`api.ts` wrapper+types,
page/modal, i18n sv+en) → `npm run build` + `cargo test` green → **user live-smoke in
`tauri dev`** (cargo+build cannot render UI; every milestone has had live-only bugs) →
commit on a `feat/*` branch → merge to `main`.

- Verify Tauri 2 / Mantine v9 / rusqlite APIs via **Context7** before using — don't build on memory.
- Feature branch for non-trivial work; run tests before declaring done.

## File map
- `src-tauri/src/`: `lib.rs` (setup + command registry + `db_health`), `db.rs`
  (connection, `SCHEMA_V1`, migrations, test conn), `error.rs`, `models.rs`
  (User/Weapon + New/Update, serde camelCase), `commands.rs` (entity CRUD + display_id/serial
  rules), `checkout.rs` (evaluate/checkout/checkin/open list), `debt.rs`, `logs.rs`, `service.rs`.
- `src/`: `App.tsx` (providers + routes), `AppLayout.tsx` (shell, footer status bar, operator
  badge), `OperatorPicker.tsx`, `CheckoutPage.tsx`, `MembersPage.tsx`, `WeaponsPage.tsx`,
  `LogsPage.tsx`, `DebtModal.tsx`, `ServiceModal.tsx`, `api.ts` (invoke wrappers + types),
  `store.ts` (Zustand), `i18n.ts`, `errors.ts`, `format.ts`, `theme.ts`.

## Status
M0–M5 done on `main`. M6 (backup/restore) + M7 (packaging/CI/updater) deferred — see
`BACKLOG.md`. Git is local-only (no remote yet → Windows installer not yet built).

## Privacy
SSN/personnummer is stored **plaintext** (deliberate). Mitigation is disk encryption
(BitLocker) + encrypting backup artifacts before they leave the device (M6) — not column
encryption. Keep this in mind for backups/export.
