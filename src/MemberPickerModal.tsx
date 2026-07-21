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
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lastShotDates, listUsers, outstandingDebts, type User } from './api';
import { userLabel } from './labels';
import { fmtDate } from './format';
import { Numpad } from './Numpad';

// Touch-first member selector: box list left, tag numpad + name search right.
// Active members only (same pool as the old dropdown).
export function MemberPickerModal({
  opened,
  onClose,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
}) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (opened) {
      setTag('');
      setText('');
    }
  }, [opened]);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const shots = useQuery({ queryKey: ['lastShotDates'], queryFn: lastShotDates, enabled: opened });
  const debts = useQuery({
    queryKey: ['outstandingDebts'],
    queryFn: outstandingDebts,
    enabled: opened,
  });
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));
  const lastMap = new Map((shots.data ?? []).map((s) => [s.userUid, s.lastShotAt] as const));
  const pool = (users.data ?? []).filter((u) => u.active && !u.isGuest);

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((u) => {
    if (tag && !(u.displayId ?? '').startsWith(tag)) return false;
    if (q && !u.name.toLowerCase().includes(q)) return false;
    return true;
  });
  // Groups: exact tag match on top, then by last shot (most recent first);
  // members who already shot today sink to the very bottom (already served
  // this session), below the never-shot group.
  const shotToday = (iso: string) => dayjs(iso).isSame(dayjs(), 'day');
  const rank = (u: User) => {
    if (tag && u.displayId === tag) return 0;
    const last = lastMap.get(u.uid);
    if (!last) return 2;
    return shotToday(last) ? 3 : 1;
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

  return (
    <Modal opened={opened} onClose={onClose} title={t('pick_member')} size="xl" centered>
      <Grid gap="md">
        <Grid.Col span={7}>
          <ScrollArea h={420} type="auto">
            <Stack gap="xs">
              {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
              {sorted.map((u) => (
                <Card
                  key={u.uid}
                  withBorder
                  padding="sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(u.uid)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{userLabel(u.name, u.displayId, true, t)}</Text>
                      {lastMap.has(u.uid) && (
                        <Text size="xs" c="dimmed">
                          {t('field_last_shot')}: {fmtDate(lastMap.get(u.uid)!)}
                        </Text>
                      )}
                    </Stack>
                    {debtMap.has(u.uid) && (
                      <Badge color="red" variant="filled">
                        {t('debt_badge', { amount: debtMap.get(u.uid) })}
                      </Badge>
                    )}
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
              placeholder={t('filter_name')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
