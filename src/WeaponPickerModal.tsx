import {
  Modal,
  Grid,
  Stack,
  Group,
  ScrollArea,
  Card,
  Text,
  Badge,
  TextInput,
  Select,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listWeapons, listOpenCheckouts, listUsers, lastWeaponUsers, type Weapon } from './api';
import { weaponLabel, userLabel } from './labels';
import { fmtDate } from './format';
import { Numpad } from './Numpad';

// Touch-first weapon selector: box list left, tag numpad + filters right.
// `pinned` floats the member's preferred / last-used weapon to the top with
// badges. `availableOnly` (checkout) greys out currently-out weapons and shows
// the holder; otherwise all active weapons are selectable (member edit).
export function WeaponPickerModal({
  opened,
  onClose,
  onSelect,
  pinned,
  availableOnly = false,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
  pinned?: { preferredUid?: number | null; lastUid?: number | null };
  availableOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [caliber, setCaliber] = useState<string | null>(null);

  // Fresh filters each time the modal opens.
  useEffect(() => {
    if (opened) {
      setTag('');
      setText('');
      setBrand(null);
      setCaliber(null);
    }
  }, [opened]);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled: opened });
  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    enabled: opened && availableOnly,
  });
  // weapon uid → its open checkout (holder shown on the disabled row).
  const outMap = new Map((open.data ?? []).map((o) => [o.weaponUid, o] as const));
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const lastUses = useQuery({
    queryKey: ['lastWeaponUsers'],
    queryFn: lastWeaponUsers,
    enabled: opened,
  });
  const lastUseMap = new Map((lastUses.data ?? []).map((l) => [l.weaponUid, l] as const));
  // weapon uid → the member whose favorite it is (at most one; DB-enforced).
  const preferrerMap = new Map(
    (users.data ?? [])
      .filter((u) => u.preferredWeaponUid != null)
      .map((u) => [u.preferredWeaponUid as number, u] as const),
  );

  const pool = (weapons.data ?? []).filter((w) => w.active);

  // Filter option values from the visible pool, not the whole table.
  const brands = [...new Set(pool.map((w) => w.brand).filter(Boolean) as string[])].sort();
  const calibers = [...new Set(pool.map((w) => w.caliber).filter(Boolean) as string[])].sort();

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((w) => {
    if (tag && !(w.displayId ?? '').startsWith(tag)) return false;
    if (brand && w.brand !== brand) return false;
    if (caliber && w.caliber !== caliber) return false;
    if (q && ![w.brand, w.model, w.serial].some((f) => f?.toLowerCase().includes(q)))
      return false;
    return true;
  });

  const label = (w: Weapon) => weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t);
  const rank = (w: Weapon) =>
    tag && w.displayId === tag
      ? 0
      : w.uid === pinned?.preferredUid
        ? 1
        : w.uid === pinned?.lastUid
          ? 2
          : 3;
  const sorted = [...filtered].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return label(a).localeCompare(label(b), 'sv');
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t('pick_weapon')} size="xl" centered>
      <Grid gap="md">
        <Grid.Col span={7}>
          <ScrollArea h={420} type="auto">
            <Stack gap="xs">
              {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
              {sorted.map((w) => {
                const out = availableOnly ? outMap.get(w.uid) : undefined;
                return (
                  <Card
                    key={w.uid}
                    withBorder
                    padding="sm"
                    opacity={out ? 0.5 : 1}
                    style={{ cursor: out ? 'default' : 'pointer' }}
                    onClick={out ? undefined : () => onSelect(w.uid)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={2}>
                        <Text fw={600}>{label(w)}</Text>
                        {out ? (
                          <Text size="xs" c="red.7">
                            {t('picker_out_held_by', {
                              name: userLabel(out.userName, out.userDisplayId, out.userActive, t),
                            })}
                          </Text>
                        ) : (
                          lastUseMap.has(w.uid) && (
                            <Text size="xs" c="dimmed">
                              {t('picker_last_used', {
                                name: userLabel(
                                  lastUseMap.get(w.uid)!.userName,
                                  lastUseMap.get(w.uid)!.userDisplayId,
                                  lastUseMap.get(w.uid)!.userActive,
                                  t,
                                ),
                                date: fmtDate(lastUseMap.get(w.uid)!.lastUsedAt),
                              })}
                            </Text>
                          )
                        )}
                      </Stack>
                      <Group gap={4} wrap="nowrap">
                        {w.uid === pinned?.preferredUid ? (
                          <Badge color="yellow" variant="light">
                            ★ {t('badge_preferred')}
                          </Badge>
                        ) : preferrerMap.has(w.uid) ? (
                          <Badge color="yellow" variant="light">
                            ★ {preferrerMap.get(w.uid)!.name}
                          </Badge>
                        ) : null}
                        {w.uid === pinned?.lastUid && (
                          <Badge color="gray" variant="light">
                            {t('badge_last')}
                          </Badge>
                        )}
                      </Group>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={5}>
          <Stack gap="xs">
            <Numpad value={tag} onChange={setTag} size="md" />
            <TextInput
              placeholder={t('filter_text_weapon')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Select
              placeholder={t('filter_brand')}
              data={brands}
              value={brand}
              onChange={setBrand}
              clearable
              searchable
            />
            <Select
              placeholder={t('filter_caliber')}
              data={calibers}
              value={caliber}
              onChange={setCaliber}
              clearable
              searchable
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
