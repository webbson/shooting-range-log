import { Modal, Stack, TextInput, Button, Text, Card, ScrollArea, Divider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listUsers, upsertGuest } from './api';
import { errorMessage } from './errors';
import { userLabel } from './labels';

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
  const q = search.trim().toLowerCase();
  const guests = (users.data ?? []).filter((u) => u.active && u.isGuest);
  const filtered = q
    ? guests.filter((u) => u.name.toLowerCase().includes(q) || (u.ssn ?? '').toLowerCase().includes(q))
    : guests;

  const mut = useMutation({
    mutationFn: () => upsertGuest(name, ssn),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onSelect(u.uid);
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Modal opened={opened} onClose={onClose} centered title={t('guest_checkout')}>
      <Stack>
        <Text fw={600}>{t('guest_existing')}</Text>
        <TextInput
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-autofocus
        />
        <ScrollArea.Autosize mah={200} type="auto">
          <Stack gap="xs">
            {filtered.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
            {filtered.map((u) => (
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
                <Text fw={600}>{userLabel(u.name, u.active, t, u.isGuest)}</Text>
              </Card>
            ))}
          </Stack>
        </ScrollArea.Autosize>

        <Divider />

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
    </Modal>
  );
}
