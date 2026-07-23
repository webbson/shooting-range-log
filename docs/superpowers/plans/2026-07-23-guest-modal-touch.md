# Guest Modal Touch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guest checkout modal touch friendly: 90% modal, shared on-screen keyboard with digit row, focus-routed typing, roomier guest cards.

**Architecture:** Two-panel modal (pick existing left / create new right) with one `Keyboard` instance bottom-right that types into whichever of the three fields (search, SSN, name) was last focused, tracked in component state. `Keyboard.tsx` grows an optional always-visible digit row.

**Tech Stack:** React + TypeScript, Mantine v9, TanStack Query, react-i18next. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-guest-modal-touch-design.md` (user-approved).
- All user-facing strings via i18n keys — this plan adds **no new keys** and must not hardcode copy.
- `onChange` handlers use `e.target`, never `e.currentTarget` (repo rule; has crashed the app twice).
- No JS unit-test harness in this repo — the deterministic gate is `npm run build` (tsc + vite), run from repo root `/Users/tom.stevens/git/shooting-range-log`. Final gate is user live-smoke in `npm run tauri dev`.
- Branch: `feat/checkout-redesign`. Commit per task.
- Do not touch `MemberPickerModal.tsx` — it keeps the letters-only keyboard.

---

### Task 1: `Keyboard` digit row (`withDigits` prop)

**Files:**
- Modify: `src/Keyboard.tsx`

**Interfaces:**
- Produces: `Keyboard` accepts new optional prop `withDigits?: boolean` (default `false`). When true, renders a row of 11 keys `1 2 3 4 5 6 7 8 9 0 -` above the letter rows. Digits and `-` append verbatim (the existing `press` lowercasing is a no-op on them). Task 2 consumes `<Keyboard value={...} onChange={...} withDisplay={false} withDigits />`.

- [ ] **Step 1: Add the digit row**

In `src/Keyboard.tsx`, add a `DIGITS` constant under the existing `ROWS` constant:

```tsx
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
```

Add the prop to the signature (after `withDisplay = true`):

```tsx
export function Keyboard({
  value,
  onChange,
  placeholder,
  withDisplay = true,
  withDigits = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  // false when the parent already renders an input bound to the same value.
  withDisplay?: boolean;
  // extra 1–0 + '-' row for fields that mix digits and letters (e.g. SSN).
  withDigits?: boolean;
}) {
```

Render the row between the `withDisplay` block and the `ROWS.map(...)` block:

```tsx
      {withDigits && (
        <SimpleGrid cols={11} spacing={4}>
          {DIGITS.map((k) => (
            <Button
              key={k}
              variant="default"
              size="lg"
              px={0}
              onClick={() => press(k)}
              styles={{ label: { fontSize: '1.1rem' } }}
            >
              {k}
            </Button>
          ))}
        </SimpleGrid>
      )}
```

Leave `press` unchanged (`toLowerCase()` is a no-op for digits and `-`).

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: exits 0, ends with `✓ built in …s` (chunk-size warning is pre-existing noise).

- [ ] **Step 3: Commit**

```bash
git add src/Keyboard.tsx
git commit -m "feat(keyboard): optional always-visible digit row (withDigits)"
```

### Task 2: GuestModal layout, focus routing, cards

**Files:**
- Modify: `src/GuestModal.tsx`

**Interfaces:**
- Consumes: `Keyboard` with `withDigits` from Task 1.
- Produces: no interface changes — `GuestModal` props stay `{ opened, onClose, onSelect }`; both call sites (`CheckoutPage` form step) are untouched.

- [ ] **Step 1: Rewrite the modal body**

Replace `src/GuestModal.tsx` content as follows. Changes vs current: modal `size="90%"`; `target` focus-routing state (reset to `'search'` on open); highlight border on the target input; keyboard bottom-right; cards `padding="md"` with big name + dimmed `SSN · date` line; `userLabel` import dropped (plain `u.name` — list is active-only).

```tsx
import { Modal, Stack, Group, Grid, TextInput, Button, Text, Card, ScrollArea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listUsers, lastShotDates, upsertGuest, type User } from './api';
import { errorMessage } from './errors';
import { fmtDate } from './format';
import { Keyboard } from './Keyboard';

// Guest checkout entry: pick a previous guest (name/SSN search) or create a
// new one. SSN identifies the guest (unique); a repeat SSN reuses the
// existing guest row (name shown then comes from the DB, not this form).
// One shared on-screen keyboard types into whichever field was last focused
// (tracked in state — DOM focus dies when a keyboard button is tapped).
export function GuestModal({
  opened,
  onClose,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [ssn, setSsn] = useState('');
  const [target, setTarget] = useState<'search' | 'ssn' | 'name'>('search');

  useEffect(() => {
    if (opened) {
      setSearch('');
      setName('');
      setSsn('');
      setTarget('search');
    }
  }, [opened]);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const shots = useQuery({ queryKey: ['lastShotDates'], queryFn: lastShotDates, enabled: opened });
  const lastMap = new Map((shots.data ?? []).map((s) => [s.userUid, s.lastShotAt] as const));

  const q = search.trim().toLowerCase();
  const guests = (users.data ?? []).filter((u) => u.active && u.isGuest);
  const filtered = q
    ? guests.filter((u) => u.name.toLowerCase().includes(q) || (u.ssn ?? '').toLowerCase().includes(q))
    : guests;

  // Same ranking/sort as MemberPickerModal: never-shot in the middle, most
  // recent first, already-shot-today sinks to the bottom.
  const shotToday = (iso: string) => dayjs(iso).isSame(dayjs(), 'day');
  const rank = (u: User) => {
    const last = lastMap.get(u.uid);
    if (!last) return 1;
    return shotToday(last) ? 2 : 0;
  };
  const sorted = [...filtered].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const av = lastMap.get(a.uid);
    const bv = lastMap.get(b.uid);
    if (av !== bv) {
      if (!av) return 1;
      if (!bv) return -1;
      return bv.localeCompare(av); // most recent first
    }
    return a.name.localeCompare(b.name, 'sv');
  });

  const mut = useMutation({
    mutationFn: () => upsertGuest(name, ssn),
    onSuccess: (u) => {
      qc.setQueryData<User[]>(['users'], (old) => (old ? [...old.filter((x) => x.uid !== u.uid), u] : [u]));
      qc.invalidateQueries({ queryKey: ['users'] });
      onSelect(u.uid);
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  // Shared keyboard routes into the last-focused field.
  const kbValue = target === 'search' ? search : target === 'ssn' ? ssn : name;
  const kbSet = target === 'search' ? setSearch : target === 'ssn' ? setSsn : setName;
  // Persistent highlight on the routed field (state-driven — CSS :focus is
  // gone the moment a keyboard button steals DOM focus).
  const hl = (f: 'search' | 'ssn' | 'name') =>
    target === f
      ? { input: { borderColor: 'var(--mantine-color-blue-6)', borderWidth: 2 } }
      : undefined;

  return (
    <Modal opened={opened} onClose={onClose} centered title={t('guest_checkout')} size="90%">
      <Grid gap="lg">
        <Grid.Col span={6}>
          <Stack>
            <Text fw={600}>{t('guest_existing')}</Text>
            <TextInput
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setTarget('search')}
              styles={hl('search')}
              size="lg"
              data-autofocus
            />
            <ScrollArea h={480} type="auto">
              <Stack gap="xs">
                {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
                {sorted.map((u) => (
                  <Card
                    key={u.uid}
                    withBorder
                    padding="md"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      onSelect(u.uid);
                      onClose();
                    }}
                  >
                    <Stack gap={2}>
                      <Text fz="lg" fw={700}>
                        {u.name}
                      </Text>
                      {(u.ssn || lastMap.has(u.uid)) && (
                        <Text size="sm" c="dimmed">
                          {[u.ssn, lastMap.has(u.uid) ? fmtDate(lastMap.get(u.uid)!) : undefined]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      )}
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Grid.Col>

        <Grid.Col span={6}>
          <Stack>
            <Text fw={600}>{t('guest_new')}</Text>
            <TextInput
              label={t('field_ssn')}
              value={ssn}
              onChange={(e) => setSsn(e.target.value)}
              onFocus={() => setTarget('ssn')}
              styles={hl('ssn')}
              placeholder="ÅÅÅÅMMDD-XXXX"
              size="lg"
            />
            <TextInput
              label={t('field_name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setTarget('name')}
              styles={hl('name')}
              size="lg"
            />
            <Button
              size="lg"
              disabled={!name.trim() || !ssn.trim()}
              loading={mut.isPending}
              onClick={() => mut.mutate()}
            >
              {t('guest_continue')}
            </Button>
            <Keyboard value={kbValue} onChange={kbSet} withDisplay={false} withDigits />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: exits 0, `✓ built in …s`. A leftover `userLabel` import would fail tsc (`noUnusedLocals`) — the rewrite above already drops it.

- [ ] **Step 3: Commit**

```bash
git add src/GuestModal.tsx
git commit -m "feat(guest): 90% modal, shared digit keyboard with focus routing, roomier cards"
```

### Task 3: Live-smoke (user gate)

- [ ] **Step 1: User runs `npm run tauri dev` and checks:**
  - Open guest modal from checkout form → search field highlighted, keyboard types into it (letters + digits).
  - Tap SSN field → highlight moves, keyboard (incl. digit row + `-`) types SSN.
  - Tap Name field → highlight moves, letters type.
  - Physical keyboard still works in all three fields.
  - Guest cards: big name, dimmed `SSN · date` line, no "(guest)" suffix, comfortable tap.
  - Pick existing guest → modal closes, guest lands in checkout form. Create new guest → same.

No commit — findings feed a fix round if any.
