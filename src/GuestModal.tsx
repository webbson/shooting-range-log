import { Modal, Stack, Group, Grid, TextInput, Button, Text, Card, ScrollArea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listUsers, lastShotDates, upsertGuest, type User } from './api';
import { errorMessage } from './errors';
import { userLabel } from './labels';
import { fmtDate } from './format';

// Guest checkout entry: pick a previous guest (name/SSN search) or create a
// new one. SSN identifies the guest (unique); a repeat SSN reuses the
// existing guest row (name shown then comes from the DB, not this form).
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

  useEffect(() => {
    if (opened) {
      setSearch('');
      setName('');
      setSsn('');
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

  return (
    <Modal opened={opened} onClose={onClose} centered title={t('guest_checkout')} size="xl">
      <Grid gap="lg">
        <Grid.Col span={6}>
          <Stack>
            <Text fw={600}>{t('guest_existing')}</Text>
            <TextInput
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-autofocus
            />
            <ScrollArea h={360} type="auto">
              <Stack gap="xs">
                {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
                {sorted.map((u) => (
                  <Card
                    key={u.uid}
                    withBorder
                    padding="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      onSelect(u.uid);
                      onClose();
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={600}>{userLabel(u.name, u.active, t, u.isGuest)}</Text>
                      {lastMap.has(u.uid) && (
                        <Text size="xs" c="dimmed">
                          {t('field_last_shot')}: {fmtDate(lastMap.get(u.uid)!)}
                        </Text>
                      )}
                    </Group>
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
              placeholder="ÅÅÅÅMMDD-XXXX"
              size="lg"
            />
            <TextInput
              label={t('field_name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
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
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
