# Handheld QR/barcode scanner support — design

Date: 2026-09-02
Status: approved, not yet implemented

## Context

The range has a handheld QR/barcode scanner that behaves as a USB keyboard: on a
successful read it types the decoded text followed by Enter. Two kinds of code
matter:

- **Weapon QR codes**, which the club prints and sticks on each weapon.
- **Swedish driving licences**, whose barcode emits the holder's personnummer.
  Verified on a real card before this design was written.

Nothing else about the app changes. The scanner is an input accelerator for
flows that already exist; every scan-driven action must be reachable by touch as
it is today.

### Prior art in the codebase

- `CheckoutPage.tsx` already listens on `window` for digits to drive the tag
  selector, because the page Stack never holds focus.
- `CheckinPage.tsx` already resolves a weapon tag to an open loan through
  `matchCheckin` / `onFastCheckinSubmit` (the fast check-in numpad). Note that
  `onFastCheckinSubmit` mutates immediately: in the numpad the operator sees the
  `matchCheckin` preview and their Enter *is* the confirmation. A scan has no
  such preview step, so it must not reuse that path unguarded.
- `LogsPage.tsx` already filters on `weaponUid` / `userUid` state.
- Rust `commands.rs::normalize_ssn` canonicalises 10/12-digit personnummer with
  century inference. It does not validate a Luhn check digit.

### Facts established during design

- `User.ssn` is returned by `listUsers` and reaches the frontend, and the query
  returns inactive rows as well as active ones. **No new Rust command is
  required** for SSN lookup.
- Member SSNs are *not* stored canonically. `create_user` only trims,
  `upsert_guest` canonicalises, and `import.rs` uses a third normalizer.
  Lookup must therefore compare **digits only, last 10**, never exact strings.
- `weapons.display_id` is matched as an exact string and is seeded unpadded
  (`"1"`…`"21"`). A scanned `v0001` must therefore resolve to `"1"`.
- A 12-digit non-personnummer will otherwise be accepted as an SSN. This is not
  hypothetical: a stray parcel-label scan (`202602032263`) is 12 digits, and the
  existing normalizer would accept it and create a junk guest. A Luhn check is
  the gate that rejects it.

## Decisions

| Fork | Decision | Rationale |
|---|---|---|
| Scan delivery | Capture-phase `window` listener in `AppLayout`, dispatching a `CustomEvent('scan')`; pages opt in via a `useScan` hook | Pages that don't listen ignore scans for free; no registration, no stale state. A Zustand `lastScan` field would need a nonce to distinguish repeat scans and would replay on remount — `/checkout` already remounts on nav click. |
| Settings storage | Zustand `persist`, alongside language / fullscreen / operator | The scanner is per-laptop hardware config. No Rust change, no migration. Deliberately *not* carried by DB backup/restore: a restored DB on another machine should not inherit another scanner's timing. |
| Weapon QR payload | `display_id` (the tag) | It is what the operator reads on screen and types on the numpad. Accepted cost: retiring a weapon frees its tag, so a reprinted sticker can collide with an old one still on a shelf. Reprint discipline stays manual. |

## 1. Settings

Three fields added to the Zustand persisted store (`store.ts`):

```ts
scannerEnabled: boolean       // default false
scannerMaxGapMs: number       // default 60 — max INTER-KEYSTROKE gap, not burst length
scannerWeaponFormat: string   // default 'v####' — a '#'-run is the zero-padded id
```

`SettingsPage` gains a "Scanner" card holding a checkbox, a NumberInput, a
TextInput, and a **Measure / test** button.

The measure modal attaches **its own** capture listener, independent of
`scannerEnabled` — the normal setup order is to measure first and enable
afterwards. The global hook is suspended while the modal is open, so it cannot
swallow the Enter or raise an "unrecognised code" toast over the very junk the
modal exists to display.

The measure modal captures the next burst and reports the raw text, the maximum
inter-keystroke gap, the total elapsed milliseconds, **and the classification
result**. Reporting the classification is what lets the weapon format and the
SSN parse be verified without checking out a weapon. It offers the measured
maximum gap × 2 as a suggested threshold, applied with one click.

Format validation: the template must match `^([^#]+)(#+)([^#]*)$`. The prefix is
required — an empty prefix would make weapon codes indistinguishable from
bare-digit personnummer.

## 2. Classifier — `src/scan.ts`

A pure, unit-tested module with no React and no I/O.

```ts
export type Scan =
  | { kind: 'weapon'; candidates: string[] }   // ['0001', '1'] — padded, then unpadded
  | { kind: 'ssn'; ssn: string }               // canonical YYYYMMDD-XXXX
  | { kind: 'unknown'; raw: string };
```

Classification order: weapon format, then SSN, then unknown.

The weapon branch builds a regex from the configured template (escaping prefix
and suffix, turning the `#`-run into `\d{n}`) and matches case-insensitively. It
returns two candidates — the digit group as scanned, and the same with leading
zeros stripped — so both padding conventions resolve without a schema change.

The SSN branch accepts a string only when, after stripping non-digits, it is 10
or 12 digits, **passes a Luhn check**, and has a plausible month (1–12) and day
(1–31, or 61–91 for a samordningsnummer). Century inference mirrors the existing
Rust rule: 20xx unless that lands in the future, otherwise 19xx.

Luhn validation lives in TypeScript only. Adding it to Rust `normalize_ssn`
would change guest-create behaviour and interact with the separate normalizer in
`import.rs`; that is out of scope.

## 3. Capture layer — `src/useScanner.ts`

Mounted once in `AppLayout`. A single **capture-phase** `window` keydown
listener, attached only while `scannerEnabled` is true.

- Printable single characters append to a buffer along with a timestamp. If
  `now - lastKeyTime > scannerMaxGapMs`, the buffer is reset before appending —
  human typing can never accumulate a burst.
- On `Enter`, if the buffer holds at least 3 characters and the gap held
  throughout, the buffer is classified. When the result is `weapon` or `ssn`,
  the handler calls `preventDefault()` and `stopImmediatePropagation()` **on the
  Enter event only**, then dispatches
  `window.dispatchEvent(new CustomEvent('scan', { detail }))`. Otherwise the
  Enter is left entirely alone.
- An `unknown` result raises a "unrecognised code" toast from the dispatcher
  itself and is not dispatched to pages.

### Why characters are allowed to leak

A burst cannot be identified as a scan until its terminating Enter arrives, so
the leading characters will always land in whatever element holds focus. This
design does not attempt to swallow and replay them: synthesising trusted key
events is not possible, and the native-setter workaround is fragile.

Instead, every input in this app is React-controlled, so each consumer overwrites
its own state on receiving a scan (`setTag(...)`, `setSearch(...)`) and the
leaked characters disappear. No DOM manipulation is involved.

Blocking the Enter is also what makes a stray scan safe while an unrelated modal
is open: digits leak into a field, but no submit fires. That is the whole of the
"modals ignore scans unless they opt in" rule.

Consumers subscribe through `useScan(handler)`, a small hook wrapping
`addEventListener('scan', …)`.

## 4. Per-page behaviour

### CheckoutPage

**Weapon scan** sets `tag`, so the existing selector logic — candidate radio
boxes, direct checkout — works unchanged. On the form step it replaces the
weapon and keeps the currently selected user. A code that matches the format but
no *active* weapon — a sticker left on a retired weapon, for instance — raises
the same "unknown weapon" toast as WeaponsPage.

**SSN scan** resolves against the cached `['users']` query using the digits-only
comparison. The selector step has no user field and its bubble-phase handler will
have appended the leaked digits to `tag`, so every branch below first clears
`tag` and moves to the form step (`setTag('')`, then
`enterForm(undefined, uid)`):

- Active member or guest: set as the user, then run the existing
  `onMemberChange` so the assigned or last-used weapon autofills.
- Inactive member: toast naming them; make no selection. Offering "create guest"
  here would walk straight into the unique-SSN rule.
- No match: open `GuestModal` with a new `initialSsn` prop prefilled.

**Scanned weapon already out**, at any point in the flow: `CheckinConfirmModal`
(below) opens on that loan. After a successful check-in the weapon **stays
selected** as now-available, because returning a weapon and handing it to the
next shooter is the common case.

### CheckinConfirmModal — one shared component

A yes/no modal taking an open-loan row. Its body is the existing `matchCheckin`
content — weapon label, borrower, checked-out-at — lifted out of `CheckinPage`
so both pages can render it. Confirming calls the check-in mutation.

It exists because no scan-driven check-in may fire without confirmation. The
same component serves the CheckoutPage weapon-out case and both CheckinPage scan
paths, so covering the request costs one component rather than three.

### CheckinPage

**Weapon scan** resolves the tag against `open.data` and opens
`CheckinConfirmModal` on that loan. It does **not** call `onFastCheckinSubmit`,
which mutates immediately; that path stays as it is for the numpad, where the
operator's Enter is the confirmation. A weapon that is not out gets an info
popup.

**SSN scan** filters the open-loans list to that user's loans. Exactly one loan
opens `CheckinConfirmModal` directly; no loans raises a "no open loans" toast;
several leave the filtered list on screen for the operator to choose from.

### MembersPage

Weapon scans are ignored. An SSN scan matches over `users.data`, switches `view`
to whichever of `active` / `inactive` / `guests` contains the match, and sets
`search` to the matched member's name. Searching by resolved name means the
existing search-field list (name, email, phone) needs no change.

A guest match switches to the `guests` view like any other. **This depends on
branch `fix/ungate-guests-filter`**, which removes the admin gate on that view;
before it lands, a guest is invisible to a non-admin operator and the scan would
have nothing to show.

The "New member" button (`MembersPage.tsx:388`) stays admin-gated, and a scan
must not route around it: no match under a non-admin operator raises a "no member
found" toast, and the create-member modal opens with the SSN prefilled only for
an admin. Creating a *guest* is open to every operator, but that happens in the
checkout flow via `GuestModal`, not on this page.

### WeaponsPage

SSN scans are ignored. A weapon scan sets `search` to the matched `displayId`,
enabling `showInactive` first if the match is inactive. An unknown code raises a
popup.

### LogsPage

Sets the existing `weaponUid` or `userUid` filter state.

### Everywhere else

`StatsPage`, `MaintenancePage`, and any page reached with no operator selected
ignore scans silently. `SettingsPage` ignores dispatched scans; its measure modal
captures the burst directly.

## 5. Testing

- `src/scan.test.ts` covers the classifier: `v0001` yields both candidates;
  `8001011231` normalises to `19800101-1231`; `202602032263` is rejected by the
  Luhn check; `OS5319+1*normal*PFB14680645*…` is unknown; a format template with
  an empty prefix is rejected by settings validation.
- No Rust changes, so `cargo test` is unaffected. `npm run build` must stay green.
- Live-smoke on the range laptop with the real scanner is the real gate. Burst
  timing cannot be exercised from the Mac dev machine.

## 6. Out of scope

- Printing the weapon QR labels. Reprint discipline after a tag move stays manual.
- Scanning inside pickers and modals other than the two flows named above.
- Non-Swedish scanner keyboard layouts. Codes are restricted to `[A-Za-z0-9]`
  plus the configured prefix/suffix characters.
- Adding Luhn validation to the Rust SSN normalizer or to `import.rs`.
