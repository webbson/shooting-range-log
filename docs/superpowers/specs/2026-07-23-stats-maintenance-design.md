# Statistics + Maintenance pages

2026-07-23 · branch `feat/stats-maintenance` · new files: `src-tauri/src/stats.rs`,
`src/StatsPage.tsx`, `src/MaintenancePage.tsx`

## Goal

Two new nav pages. **Statistik**: loan counts over a selectable period with a
breakdown bar chart, weapon usage, member activity, active debts — each
exportable to CSV. **Underhåll**: actionable worklists — stale weapon
assignments (with fast unassign), never-borrowed weapons, condition-tagged
weapons, guest list with promote.

## Decisions (user-approved)

1. Two separate pages (nav entries), no tab layer.
2. Period picker: presets only — Idag / Vecka / Månad / År / Allt. No custom range.
3. Loan counts shown as number tiles + breakdown bar chart in plain CSS
   (flex divs) — **no chart dependency**.
4. Usage stats trimmed to loans per period only (no weekday/hour, calibers,
   mileage, operator counts). Money trimmed to active (outstanding) debts only.
5. Inactive-members stat cut — members with own weapons never appear in loan
   data, so only stale *assignments* matter (covered by Underhåll).
6. Stale threshold: months select 1–12, default 3.
7. Guests: all active guests sorted by loan count desc, promote button per row
   (admin-gated, existing `promote_guest` flow).
8. Export: per-section CSV buttons + a raw-loans export (base data for Excel
   pivots). CSV = `;` separator + UTF-8 BOM (Swedish Excel). No xlsx.

## Design

### Backend — new module `src-tauri/src/stats.rs`

Module pattern as elsewhere: inner fns take `&Connection` (unit-tested with
`db::migrated_in_memory()`), thin `#[tauri::command]` wrappers lock the mutex,
all registered in `lib.rs` `generate_handler!`. All read-only except CSV write.

Period params: `from: Option<String>, to: Option<String>` (UTC RFC3339,
computed frontend-side; both `None` for Allt). Filter on
`checked_out_at >= from AND checked_out_at < to`.

Commands (structs serde camelCase in `models.rs` or local to `stats.rs`):

- `stats_summary(from, to)` → `{ loanCount, memberCount, guestCount }` —
  loans in period, distinct non-guest borrowers, distinct guest borrowers.
- `stats_loans_buckets(from, to, bucket)` → `Vec<{ bucket: String, count: i64 }>`.
  `bucket` ∈ `hour | day | month | year`, mapped to
  `strftime('%H' | '%Y-%m-%d' | '%Y-%m' | '%Y', checked_out_at, 'localtime')`
  GROUP BY. `'localtime'` because timestamps are stored UTC and buckets must
  match the operator's wall clock. Empty buckets are NOT returned — frontend
  fills gaps with zeros (it knows the preset's range).
- `stats_weapon_usage(from, to)` → per weapon: uid, displayId, brand, model,
  caliber, active, count — loans in period, count desc. Live identity via JOIN
  (same as logs rows); frontend composes labels via `labels.ts`.
- `stats_member_activity(from, to)` → per borrower: uid, name, isGuest, active,
  count — count desc. Guests included, marked with existing guest suffix.
- `maintenance_stale_assignments(months)` → members (active, non-guest) with
  `preferred_weapon_uid` set where the last checkout row with
  `user_uid = member AND weapon_uid = assigned weapon` is older than N months
  **or no such row exists**. Returns member uid+name, weapon fields for label,
  `lastUsed: Option<String>`.
- `maintenance_never_borrowed()` → active weapons with zero checkout rows
  all-time: weapon fields + `createdAt`.
- `maintenance_tagged_weapons()` → active weapons where any of
  `tag_needs_service/tag_broken/tag_missing_parts/tag_needs_cleaning` is set
  or `tag_comment` non-empty: weapon fields + the tag columns.
- `maintenance_guests()` → active guests: uid, name, loan count (all-time),
  `lastVisit: Option<String>`, count desc.
- `export_csv(kind, from, to, months, path)` → writes file at `path`, returns
  row count. `kind` ∈ `loans_raw | weapon_usage | member_activity | debts |
  stale_assignments | guests`. Reuses the query fns above (debts reuses the
  existing outstanding-debts query in `debt.rs`). Format: UTF-8 BOM, `;`
  separator, CRLF, header row with **Swedish** column names, fields quoted
  when containing `;`/quote/newline. Timestamps formatted `YYYY-MM-DD HH:MM`
  local time; kronor as plain integers.
  - `loans_raw` columns: Utlämnad, Återlämnad, Vapen-ID, Vapen, Serienummer,
    Låntagare, Gäst (Ja/Nej), Utlämnad av, Mottagen av — one row per loan in
    period (open loans included, Återlämnad empty).

Active debts list: reuse existing `debt.rs` outstanding-debts command — no new
query.

### Frontend — `src/StatsPage.tsx`

Layout: page header + `SegmentedControl` presets Idag / Vecka / Månad / År /
Allt (default Månad). Preset → `{from, to, bucket}` computed with dayjs
(calendar units: Idag = today 00:00→now, Vecka = ISO week start, Månad = 1st,
År = Jan 1, Allt = no bounds). Bucket per preset: Idag→hour, Vecka→day,
Månad→day, År→month, Allt→year.

Sections top to bottom:

1. **Tiles**: Lån / Medlemmar / Gäster — `Card` row with big numbers
   (`stats_summary`).
2. **Bar chart**: pure CSS — a flex row of columns, each column a teal bar
   (`height` %-scaled to max count) with count above and bucket label below
   (hour `HH`, day `D` or `D/M`, month short name, year). Zero-filled buckets
   from the preset range. No axis, no grid lines, no library.
3. **Vapenanvändning**: table weapon label · count, desc.
4. **Medlemsaktivitet**: table member label · count, desc.
5. **Aktiva skulder**: table member · amount · date (existing outstanding
   debts query via existing api fn).

Sections 3–5 each get an export icon-button; page header gets
"Exportera lån (CSV)" for `loans_raw`. Export flow: `save()` from
`@tauri-apps/plugin-dialog` (default filename e.g. `lan-2026-07.csv`) →
`invoke('export_csv', { kind, from, to, path })` → success/error notification.

All queries TanStack Query keyed on `['stats', section, from, to]`.

### Frontend — `src/MaintenancePage.tsx`

Sections top to bottom (each a `Card` with heading, tables inner-scroll if
long):

1. **Ej använda tilldelade vapen**: months `Select` 1–12 default 3 (label
   "senaste X månader"). Rows: member name · weapon label · last-used date
   (or "aldrig") · button "Ta bort tilldelning" → yes/no confirm `Modal`
   (existing confirm-popup pattern) → `set_preferred_weapon(uid, null)` →
   invalidate stats/maintenance/member queries. Not admin-gated (assignment
   changes at checkout aren't either).
2. **Aldrig utlånade vapen**: weapon label · registered date.
3. **Vapen med åtgärdsmarkering**: weapon label · tag `Badge`s + comment;
   row click opens existing `TagModal` (reused as-is) → invalidate on save.
4. **Gäster**: name · loan count · last visit · "Gör till medlem" button —
   admin-gated via `useIsAdmin` (hidden when gated), confirm popup, calls
   existing `promote_guest`, invalidates.

Sections 1 and 4 get the same export icon-button (kinds `stale_assignments`,
`guests`). Never-borrowed and tagged lists are short worklists — no export.

### Cross-cutting

- Routes `/stats`, `/maintenance` in `App.tsx`; nav entries in `AppLayout.tsx`
  with tabler icons (e.g. `IconChartBar`, `IconTool`).
- `api.ts`: invoke wrappers + TS types for every new command.
- i18n: every string keyed in `i18n.ts`, sv + en. CSV headers stay Swedish
  regardless of UI language (board reads Swedish).
- Times displayed via `format.ts`.
- No schema change, no new migration, no new dependency.
- `seed.rs`: verify dataset exercises every section (stale assignment, never-
  borrowed weapon, tagged weapon, repeat guest); extend if a case is missing.

## Verification

- `cargo test`: unit tests per query fn (period filtering, bucket grouping,
  stale or-never logic, never-borrowed excludes borrowed+inactive, guest
  counts, CSV content incl. BOM/`;`/quoting).
- `npm run build` green.
- Live-smoke: preset switching redraws bars, exports open correctly in Excel
  (åäö intact), unassign confirm + list refresh, TagModal roundtrip, promote
  gated/ungated per admin state.
