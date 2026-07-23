# Guest modal touch redesign

2026-07-23 · branch `feat/checkout-redesign` · files: `src/GuestModal.tsx`, `src/Keyboard.tsx`

## Goal

Make the guest checkout modal (pick previous guest / create new guest) better looking
and touch friendly on the kiosk touchscreen. Current problems: no on-screen keyboard
(SSN/name/search can't be typed by touch), cramped guest cards with awkward wrapping,
dead space, small targets.

## Decisions (user-approved)

1. **Structure:** keep two panels in one modal — pick-existing left, create-new right —
   with one shared on-screen keyboard bottom-right. No stepped flow.
2. **Keyboard:** digit row always visible (`1 2 3 4 5 6 7 8 9 0 -` above the letter
   rows). No mode switching between fields.
3. **Cards:** name (large, bold) + second dimmed line `SSN · last-shot-date`.
   Drop the "(guest)" suffix inside this modal.

## Design

### Layout

- `Modal size="90%"` (same as MemberPickerModal), title `guest_checkout` unchanged.
- Left column: `guest_existing` heading, search `TextInput` on top, scrollable guest
  card list below (sorting unchanged: recent-not-today first, never-shot, shot-today
  last).
- Right column: `guest_new` heading, SSN + Name inputs (`size="lg"`), Continue button
  (disabled until both non-empty, unchanged), shared `Keyboard` underneath.

### Keyboard + focus routing

- `Keyboard.tsx`: new optional prop `withDigits` (default `false`). When set, renders
  an extra top `SimpleGrid` row with `1 2 3 4 5 6 7 8 9 0 -` (11 keys — fits the
  existing 11-column grid). Digits and `-` append verbatim (no lowercasing effect).
  MemberPickerModal untouched (keeps letters-only).
- `GuestModal` tracks `target: 'search' | 'ssn' | 'name'` in state, default `'search'`.
  Each `TextInput` sets it via `onFocus`. Keyboard `onChange` writes to the target
  field's state.
- The target field shows a persistent highlight (blue border via `styles.input`),
  driven by the `target` state — DOM focus is unreliable because keyboard buttons
  steal it on tap.
- Physical keyboard keeps working in all fields (inputs stay editable, not readOnly).

### Guest cards

- `padding="md"`, whole card tappable (unchanged behavior: select + close).
- Line 1: `u.name` — `fz="lg" fw={700}` (plain name; pool is active-only so no
  disabled suffix needed).
- Line 2: dimmed `size="sm"`: SSN and last-shot date joined with ` · ` (each part
  only when present).

### Unchanged

`upsertGuest` mutation + cache seeding, select/close behavior, error toasts, SSN
backend normalization, i18n keys (no new keys), `data-autofocus` on search.

## Verification

- `npm run build` green.
- Live-smoke: type SSN by touch, tap between fields (highlight follows), search with
  digits, pick existing guest, create new guest, physical keyboard still types.
