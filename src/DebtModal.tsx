import {
  Modal,
  Stack,
  Group,
  Text,
  Badge,
  NumberInput,
  TextInput,
  Button,
  Divider,
  ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { listUserDebts, addDebt, settleDebt } from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDate } from './format';

export function DebtModal({
  userUid,
  userName,
  opened,
  onClose,
}: {
  userUid: number | null;
  userName: string;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);
  const [amount, setAmount] = useState<number | string>('');
  const [reason, setReason] = useState('');

  const debts = useQuery({
    queryKey: ['userDebts', userUid],
    queryFn: () => listUserDebts(userUid!),
    enabled: opened && userUid != null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['userDebts', userUid] });
    qc.invalidateQueries({ queryKey: ['outstandingDebts'] });
    qc.invalidateQueries({ queryKey: ['eval'] });
  };
  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const addMut = useMutation({
    mutationFn: () => addDebt(userUid!, operator!.uid, Number(amount), reason || undefined),
    onSuccess: () => {
      setAmount('');
      setReason('');
      invalidate();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  const settleMut = useMutation({
    mutationFn: (id: number) => settleDebt(id, operator!.uid),
    onSuccess: invalidate,
    onError,
  });

  const outstanding = (debts.data ?? [])
    .filter((d) => d.settledAt == null)
    .reduce((s, d) => s + d.amountKr, 0);

  return (
    <Modal opened={opened} onClose={onClose} title={`${t('debt_for')} ${userName}`} centered size="lg">
      <Stack>
        <Group>
          <Text fw={600}>{t('outstanding')}:</Text>
          <Badge color={outstanding > 0 ? 'red' : 'gray'} size="lg">
            {outstanding} kr
          </Badge>
        </Group>

        <Divider />

        <Group align="flex-end">
          <NumberInput
            label={t('field_amount_kr')}
            value={amount}
            onChange={setAmount}
            min={1}
            allowDecimal={false}
            suffix=" kr"
            w={150}
          />
          <TextInput
            label={t('field_reason')}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => addMut.mutate()}
            loading={addMut.isPending}
            disabled={!operator || !amount || Number(amount) <= 0}
          >
            {t('add_debt')}
          </Button>
        </Group>

        <Divider />

        <ScrollArea.Autosize mah={300}>
          <Stack gap="xs">
            {(debts.data?.length ?? 0) === 0 ? (
              <Text c="dimmed">{t('no_debts')}</Text>
            ) : (
              (debts.data ?? []).map((d) => (
                <Group key={d.id} justify="space-between" wrap="nowrap">
                  <Stack gap={0}>
                    <Text fw={600}>
                      {d.amountKr} kr {d.reason && `· ${d.reason}`}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {fmtDate(d.createdAt)}
                    </Text>
                  </Stack>
                  {d.settledAt ? (
                    <Badge color="gray" variant="light">
                      {t('settled')}
                    </Badge>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      color="teal"
                      loading={settleMut.isPending}
                      onClick={() => settleMut.mutate(d.id)}
                    >
                      {t('settle')}
                    </Button>
                  )}
                </Group>
              ))
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}
