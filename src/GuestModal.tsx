import { Modal, Stack, TextInput, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upsertGuest } from './api';
import { errorMessage } from './errors';

// Guest checkout entry: SSN identifies the guest (unique); a repeat SSN reuses
// the existing guest row (name shown then comes from the DB, not this form).
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
  const [name, setName] = useState('');
  const [ssn, setSsn] = useState('');

  useEffect(() => {
    if (opened) {
      setName('');
      setSsn('');
    }
  }, [opened]);

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
        <TextInput
          label={t('field_ssn')}
          value={ssn}
          onChange={(e) => setSsn(e.target.value)}
          placeholder="ÅÅÅÅMMDD-XXXX"
          size="lg"
          data-autofocus
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
