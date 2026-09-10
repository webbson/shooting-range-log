<img src="src-tauri/icons/128x128@2x.png" alt="" width="96" align="left" hspace="12" vspace="4">

# Shooting Range Log

Desktop app for managing weapons, members, and weapon checkout/checkin on a shooting
range. Built for a touch-screen Windows laptop, operated by staff. Bilingual (Swedish /
English). Developed on macOS, shipped to Windows.

<br clear="left">

## Features

### Members & weapons
- CRUD with active/inactive state. A movable display **ID** (the physical tag) is separate
  from the hidden internal key: required while a weapon is active, auto-fillable to the next
  free number, and freeable on deactivation so the tag is reusable. Weapons also track serial
  and caliber; members render as a bare name.
- Identity in logs and lists is resolved **live** (`name`, `brand model, caliber [id]`, or
  `name [disabled]` once retired) — never snapshotted.
- Lists show active only by default, with text search and a *show inactive* toggle. Rows open
  a read-only info modal with that member's or weapon's history.
- Creating a weapon offers **suggestions** for brand/model/caliber (a curated list merged with
  values already in the database) and can be **based on an existing weapon**.
- **Assigned weapon** — a member can have one weapon assigned to them, and a weapon belongs to
  at most one member. Checkout suggests it first.
- **Guests** — walk-ins are created at checkout from name + personnummer, reused on their next
  visit, and can be promoted to full members by an admin.
- **Condition tags** — per weapon: needs service, broken, missing parts, needs cleaning, plus a
  free comment. Shown as chips wherever the weapon is picked.

### Checkout / checkin
- Weapon-first flow: tag numpad or picker, then the member; candidate members (assigned holder,
  last borrower) are offered as one-tap direct checkout.
- **Barcode/QR scanner support** — scanning a weapon tag or a personnummer drives the flow,
  including direct checkout and routing between the checkout and check-in screens.
- Colour-coded warnings for outstanding **debt**, **inactive** weapon or member, a weapon that is
  **already checked out** (with its holder), and a fresher-user mismatch.
- Check-in screen lists open loans as cards with check-in, debt, assign and tag actions; a numpad
  handles fast tag check-in.
- An idle prompt asks whether to finish or cancel a half-finished checkout; the operator is logged
  out after a configurable idle period.

### Records
- **Logs** — filterable checkout history (weapon, member, operator, date range, open only),
  serving both "weapon checkout log" and "member shooting log".
- **Debt** — whole kronor owed by a member, added from a checked-out weapon or the member's debt
  view, highlighted whenever that member is selected, settled from the same view.
- **Weapon service log** — append-only, operator-tagged service history per weapon.
- **Statistics** — day/week/month/year periods with ‹ › navigation, number tiles, a bar chart, and
  weapon-usage / member-activity / debt tables. Six CSV exports.
- **Maintenance** — stale assignments, never-borrowed weapons, tagged weapons, and guests by loan
  count with admin-gated promotion.
- Every checkout, check-in, service entry and debt row is tagged with the current operator.

### Operations
- **Backups** — local snapshot every 10 minutes and on exit, GFS retention, optional encrypted
  (age passphrase) upload to any S3-compatible bucket, and restore from a local or remote file.
- **Excel import** — historical loans and weapons from the club's spreadsheet (rows with a valid
  personnummer but no member become guests), plus a separate member-roster import.
- **Auto-update** — prompts on launch when a new release is available.
- **Settings** — import, backup, scanner, timeouts, appearance (background image, surface
  opacity), and an admin danger zone that can wipe the database or just the history.

## Stack
Tauri 2 (Rust) · React + TypeScript + Mantine v9 · SQLite (rusqlite, bundled) ·
TanStack Query · Zustand · react-i18next.

## Prerequisites
- Node.js + npm
- Rust toolchain (stable)
- Tauri 2 platform deps — see <https://v2.tauri.app/start/prerequisites/>

## Develop
```bash
npm install
npm run tauri dev        # launches the desktop app with hot reload
npm run seed             # wipe + refill the dev database with mock data (app closed)
```
The SQLite database is created automatically in the OS app-data directory on first run;
pending migrations apply on launch.

## Test & build
```bash
npm run check            # all gates: rust warnings (denied), cargo tests, typecheck+bundle, scan checks
```
Individually: `npm run lint:rust`, `npm run test:rust`, `npm run build`, `npm run test:scan`.

The Windows installer (NSIS) is produced by CI on a Windows runner on `v*` tag push
(`.github/workflows/release.yml`) — Tauri cannot cross-build from macOS.

## Project layout
- `src-tauri/` — Rust core: commands, SQLite + migrations, domain logic, backup/S3, imports.
- `src/` — React + Mantine frontend.
- `src-tauri/icons/icon.svg` — source of the app icon; the raster set is generated with
  `npm run tauri icon`.
- `CLAUDE.md` — architecture conventions and contributor guide.
- `BACKLOG.md` — deferred work.

## Privacy note
Member SSN/personnummer is stored in plaintext by design. Protect the device with disk
encryption (BitLocker) and encrypt backups before moving them off the machine.
This repository is public — no real personal data belongs in it, in any form.
