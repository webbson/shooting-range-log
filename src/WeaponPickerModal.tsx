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
import { listWeapons, listOpenCheckouts, type Weapon } from './api';
import { weaponLabel } from './labels';
import { Numpad } from './Numpad';

// Touch-first weapon selector: box list left, tag numpad + filters right.
// `pinned` floats the member's preferred / last-used weapon to the top with
// badges. `availableOnly` restricts to active weapons not currently out
// (checkout); otherwise all active weapons (member edit).
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
  const outSet = new Set((open.data ?? []).map((o) => o.weaponUid));

  const pool = (weapons.data ?? []).filter(
    (w) => w.active && (!availableOnly || !outSet.has(w.uid)),
  );

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
    w.uid === pinned?.preferredUid ? 0 : w.uid === pinned?.lastUid ? 1 : 2;
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
              {sorted.map((w) => (
                <Card
                  key={w.uid}
                  withBorder
                  padding="sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(w.uid)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{label(w)}</Text>
                      {w.serial && (
                        <Text size="xs" c="dimmed">
                          {w.serial}
                        </Text>
                      )}
                    </Stack>
                    {w.uid === pinned?.preferredUid ? (
                      <Badge color="yellow" variant="light">
                        ★ {t('badge_preferred')}
                      </Badge>
                    ) : w.uid === pinned?.lastUid ? (
                      <Badge color="gray" variant="light">
                        {t('badge_last')}
                      </Badge>
                    ) : null}
                  </Group>
                </Card>
              ))}
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
