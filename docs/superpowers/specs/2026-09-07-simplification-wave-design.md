# Simplification wave — design

Date: 2026-09-07
Status: approved for implementation

Five independent workstreams. A–E can ship in any order; only C and D touch the
same area (`import.rs` and the Settings import UI) and must be sequenced.

---

## A. Drop operator status

**Today:** an operator is a user with `is_staff`. `OperatorPicker` lists only
those, via `list_operators`.

**Wanted:** every active member can operate the software. The picker becomes a
member search like the one used at checkout.

**Decision (Tom):** stop *using* `is_staff`; leave the column in place. No
migration, reversible, smallest diff.

- `OperatorPicker.tsx` — swap `list_operators` for `list_users`; show active,
  non-guest members with a search box modelled on `MemberPickerModal` (name
  search, large tap targets). Keep the store shape `{ uid, name, isAdmin }`.
- `MembersPage.tsx` — remove the staff checkbox from the edit form and the
  "staff" badge from the list. Leave `isStaff` in the `MemberForm` type and the
  payload so nothing else has to change.
- `LogsPage.tsx` — the operator filter dropdown must switch from
  `list_operators` to active users. Once `is_staff` stops being set, an operator
  list built from it would omit most people who actually recorded actions.
- `list_operators` stays registered and unused. Do not delete it; the Logs page
  is its last caller and the column may come back.
- i18n: `no_operators_hint` and `staff` become orphans. Leave them; a copy pass
  can sweep them later.

**Explicitly unchanged:** `is_admin`. Admin gating stays exactly as it is, and
`useIsAdmin`'s bootstrap rule (gating off while no active admin exists) still
applies.

---

## B. Backup — remote retention and interval

**Two separate problems. Only the second is a bug.**

### B1. Interval
`lib.rs:225` sleeps 600 s. Change to 3600 s. Note this does **not** reduce the
retained file count: the `today` tier keeps one snapshot per clock-hour, so the
cap was already ~24/day. It reduces the work, and on an S3-configured install it
reduces uploads six-fold.

### B2. Remote retention never prunes — root cause is a blind spot, not the policy
Local retention is correct and confirmed working: this Mac's backup dir holds
five files spanning June–September, each in a distinct GFS slot. The range
laptop (local only) shows one per day, as designed.

The remote side is different. `upload_encrypted` (`lib.rs:58`) does call
`s3::retention_remote` after every upload, and the timer does call
`upload_encrypted`, so the call chain is intact. But **`s3.rs:283` and `s3.rs:290`
both discard the result of `delete_object` with `let _ =`**, and the callers
discard the outcome again. Every possible failure is silent.

**The obvious hypothesis is already eliminated.** Tom confirms the API key has
read **and write** on the Cloudflare R2 bucket, so a missing `DeleteObject`
permission is not the cause.

**Narrowed to the delete call itself.** Tom confirms the app's backup list shows
every remote snapshot with the Remote source flag. `list_remote` and
`retention_remote` share identical logic for listing, striping the prefix and
parsing the timestamp — the same `bucket.list(prefix, Some("/"))`, the same
`strip_prefix(&prefix).unwrap_or(&obj.key)`, the same `parse_backup_timestamp`.
So a correct remote listing in the UI proves that in `retention_remote` the list
returns objects, the prefix strips cleanly, the timestamps parse, and `entries`
is populated. `gfs_slot` is shared with local retention, which is confirmed
working.

Everything upstream of the delete is therefore proven good, and permissions are
ruled out. **The failure is isolated to `bucket.delete_object(key)`.** The
leading candidate is a request-signing incompatibility between `rust-s3` and R2
on DELETE — R2 is stricter than AWS about the empty-payload SHA256 — which
returns a 403 that `let _ =` discards. A wrong `s3_region` is a second candidate;
R2 expects `auto`.

**This is exactly why the instrumentation is the deliverable, not a guess.** Every
failure path in this chain is currently silent, so no hypothesis can be confirmed
or killed from the code alone. Make it speak, run it once against the real bucket,
and the cause names itself.

**Fix the blind spot first:**
- `retention_remote` returns a small summary — objects considered, deleted, and
  a list of keys whose delete failed with the error text. Capture the **HTTP
  status code and response body** from a failed delete, not just a Display
  string: distinguishing 403 `SignatureDoesNotMatch` from 403 `AccessDenied` is
  the whole point, and one is a client bug while the other is a bucket setting.
- Stop discarding delete results. Collect failures instead.
- `backup_now` surfaces that summary in its toast, so pressing "Backup now"
  answers the question directly ("deleted 5" vs "0 deleted, 5 failed: AccessDenied").
- The timer logs the same summary via `eprintln!` rather than `let _`.
- Same treatment for the timer's `let _ = backup::retention_local(...)`
  (`lib.rs:241`, `lib.rs:328`) — log the error rather than swallow it.

Do **not** change the GFS policy. Tom confirmed the local behaviour is what he
wants.

---

## C. Rename the existing Excel sync; stop managing members

**Today:** `import.rs` creates and updates members from a spreadsheet and sets
their preferred weapon from the `vapen` column.

**Wanted:** this import becomes *loans/weapons only*. It never creates, updates
or deactivates a member again — that is now workstream D's job.

- Rename in the UI to "sync loans/weapons from Excel file" (i18n, both languages).
- Matching: find an existing member by personnummer only. Reuse the Rust
  `normalize_ssn` and compare on the **last 10 digits**, for the same reason the
  scanner does: member SSNs are not stored canonically (`create_user` trims,
  `upsert_guest` canonicalises, `import.rs` has its own normalizer). Consolidate
  onto one comparison rather than adding a fourth.
- A row that matches no member is **skipped**, never created.
- Unmatched rows are reported two ways:
  1. a warning list in the import result UI, showing enough to identify the
     person (name, personnummer, and the weapon the row referenced);
  2. an export of those rows to a file, using the existing `export_csv`
     machinery and its established conventions — `;`-separated, UTF-8 BOM,
     Swedish headers, local timestamps.
- Preserve the existing preview → commit flow; the warning list appears in the
  preview so nothing is committed before Tom has seen it.

---

## D. New member import from the Svenska Lag export

A second, separate import. Source is the club's member export; an API is
promised later, so keep the parsing isolated behind one module to make that swap
cheap.

**Verified against the real file** (`Export_av_personer__Landskrona_Pistolklubb__20260907.xlsx`,
172 members):
- **Never hard-code the header row index.** The real file is: row 1 club-name
  banner, row 2 *blank*, row 3 headers, rows 4–175 data. An earlier draft of this
  spec said "headers on row 2" — that was wrong, because the blank row is not
  emitted in the sheet XML and a naive parse silently renumbers everything after
  it. Find the header row by scanning the first few rows for a known column name
  (`Personnr.`), and keep a test that covers the blank-row layout, or a later
  "simplification" to a fixed index will pass the tests and break on the real file.
- Match columns **by header name**, not position — the export has 43 columns and
  will drift.
- `Personnr.` is present on all 172 rows, all in `YYYYMMDD-XXXX`, no duplicates.
  That is already our canonical form, so matching is exact.
- `Förnamn` + `Efternamn` are present on every row → `name`.
- `E-post` holds **comma-separated multiples on 9 rows**; 12 rows are empty. Take
  the first address, trimmed.
- `Mobil` is empty on 21 rows, and the populated ones contain spaces and a
  dash. Never copy a real value into a test or a doc — the repo is public and
  this file holds live personal data.
- `Adress` / `Postnr` / `Ort` are complete on every row → compose one `address`.
- `Medlemstyp` is `Medlem` (164) or `Styrelsemedlem` (8).
- `Provtränar` is empty on every row — ignore it.
- 13 rows carry a `Titel`, but only 8 are `Styrelsemedlem`. **The admin rule keys
  on `Medlemstyp`, never on `Titel`.**

**Behaviour:**
- Create members that are absent from our DB.
- Update matched members' name, email, phone and address from the file.
- `Medlemstyp == "Styrelsemedlem"` → `is_admin = true`; every other row →
  `is_admin = false`. The file is the source of truth for board membership.
  Report every admin change in the preview so a demotion is never a surprise.
- **Deactivate members present in our DB but missing from the file.**
  **Guests are exempt** (Tom's decision): a walk-in guest will never appear in
  the club's member list, so including them would retire every guest on each
  import. Only non-guest members are considered.
- Deactivation must go through the existing `set_active(false)` path so the
  preferred-weapon slot is cleared, per the identity rules in CLAUDE.md.
- Preview → commit, mirroring the existing import UI: counts for create, update,
  admin-promote, admin-demote and deactivate, each with the affected names, and
  nothing written until Tom confirms.

---

## E. Page background image

A picked image shown behind every page, subtly.

**Decision (Tom): copy the file into the app data directory.** Referencing the
original path would leave the background silently vanishing if the file moves or
lives on a removed USB stick.

- Settings gains an image picker (`@tauri-apps/plugin-dialog`). The chosen file
  is copied to `<app_data>/background/` by a Rust command, replacing any previous
  one.
- **Loading it into the WebView:** a Rust command returns the image as a data
  URL. This avoids configuring the Tauri asset protocol scope and touching CSP
  for one cosmetic feature. Verify the approach against Tauri 2 docs via Context7
  before building.
- Display settings, stored in the persisted Zustand store alongside the scanner
  settings — this is per-laptop cosmetic config, and the file itself lives on
  that machine:
  - position: a 9-point grid (top-left … bottom-right, centre)
  - size: cover / contain / actual size
  - opacity: a slider, defaulting low enough to stay legible behind content
  - an enable/disable toggle, and a way to clear the image
- Rendering: one fixed-position layer behind the AppShell content, `pointer-events:
  none`, so it can never intercept a touch. It must sit behind Mantine modals and
  the footer status bar as well as page content.
- Legibility is the constraint that matters on a touch screen in a bright range:
  default opacity low, and check both light and dark themes.

### E2. Follow-ups from Tom's first look at the running feature

**Margin.** With `bottom right`, the image sits flush in the corner. The layer is
`position: fixed; inset: 0`, so a `backgroundMargin` setting rendered as
`inset: <n>px` shrinks the painting box and pushes the image off every edge by
that much. One number, one control, no change to the position keywords.

**Surface opacity.** The row boxes on each page should let the logo show through.
Add a `surfaceOpacity` setting applied as a CSS custom property, and blend the
surface colour against transparent with `color-mix` against Mantine's own body
colour token, so it follows the light/dark theme instead of hard-coding a colour.

The trap: Mantine renders modals, popovers, menus and select dropdowns as `Paper`
too, so a blanket `.mantine-Paper-root` rule would make every overlay
see-through and unreadable. Those all render through a portal at body level,
**outside** `AppShell.main` — so scope the rule to
`.mantine-AppShell-main` and page surfaces go translucent while every overlay
stays solid. Verify the current Mantine v9 surface variable names through
Context7 rather than assuming; do not guess at `--mantine-color-body`.

Both settings live in the persisted Zustand store beside the existing background
fields, and both need sensible defaults that leave the app legible if the image
is busy: zero margin, and a surface opacity high enough to read text over.

---

## Testing

- Rust: unit tests per new module using `db::migrated_in_memory()`, matching the
  existing convention. For D, cover the row-2 header offset, comma-separated
  email, the Styrelsemedlem admin rule, guest exemption from deactivation, and a
  member missing from the file.
- For C, cover: unmatched row is skipped and reported, matched row binds usage.
- `npm run build` and `cargo test` green before any workstream is called done.
- Live-smoke by Tom in `tauri dev` before merge, per CLAUDE.md. B2 in particular
  can only be settled against the real S3 bucket.

## Out of scope

- Dropping the `is_staff` column, or the `list_operators` command.
- Changing the GFS retention policy itself.
- The Svenska Lag API (not released yet) — the Excel path is the interim.
- Per-user or club-wide sharing of the background image.
