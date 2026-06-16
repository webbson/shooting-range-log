# Shooting Range Log

Desktop app for managing weapons, members, and weapon checkout/checkin on a shooting
range. Built for a touch-screen Windows laptop, operated by staff. Bilingual (Swedish /
English). Developed on macOS, shipped to Windows.

## Features
- **Members & weapons** — CRUD with active/inactive state. A movable display **ID** (the
  physical tag) is separate from the hidden internal key. An ID is **required while active**,
  auto-fillable to the next free number, and can be **freed on deactivation** so it's reusable
  on another weapon/member. Weapons also track serial + caliber. Identity in logs/lists is
  resolved **live** (shown `name (id)`, or `name (disabled)` once retired) — never snapshotted.
- **Checkout / checkin** — enter a weapon or a member; the other side autopopulates
  (overridable). Loud, colour-coded banners warn about: outstanding **debt**, **inactive**
  weapon/member, a weapon that's **already checked out** (with the holder), and a
  **fresher-user mismatch**. Already-out weapons can't be selected.
- **Debt** — record free-form amounts (whole kr) owed by a member; add from a checked-out
  weapon's **Add debt** button or the member's debt view; highlighted whenever the member is
  selected; settle from the member's debt view.
- **Logs** — filterable checkout history (by weapon, member, operator, date range, open-only)
  serving both "weapon checkout log" and "member shooting log".
- **Weapon service log** — append-only, operator-tagged service history per weapon.
- Every checkout/checkin/service/debt action is tagged with the operator selected at launch.

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
```
The SQLite database is created automatically in the OS app-data directory on first run;
pending migrations apply on launch.

## Test & build
```bash
cargo test --manifest-path src-tauri/Cargo.toml   # backend logic
npm run build                                      # frontend typecheck + bundle
```
Windows installers (`.msi` / NSIS) are produced by CI on a Windows runner
(`.github/workflows/build-windows.yml`) — Tauri cannot cross-build from macOS.

## Project layout
- `src-tauri/` — Rust core: commands, SQLite + migrations, domain logic.
- `src/` — React + Mantine frontend.
- `CLAUDE.md` — architecture conventions and contributor guide.
- `BACKLOG.md` — deferred work (backup/restore, packaging/auto-update, fine-tuning).

## Privacy note
Member SSN/personnummer is stored in plaintext by design. Protect the device with disk
encryption (BitLocker) and encrypt backups before moving them off the machine.
