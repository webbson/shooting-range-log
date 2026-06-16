import {
  SimpleGrid,
  Card,
  Stack,
  Group,
  Title,
  Text,
  Select,
  TextInput,
  Button,
  Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  listUsers,
  listWeapons,
  listOpenCheckouts,
  evaluateCheckout,
  doCheckout,
  doCheckin,
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';

export function CheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const open = useQuery({ queryKey: ['openCheckouts'], queryFn: listOpenCheckouts });

  const evalQ = useQuery({
    queryKey: ['eval', weaponUid, userUid],
    queryFn: () => evaluateCheckout(weaponUid, userUid),
    enabled: weaponUid != null || userUid != null,
  });
  const ev = evalQ.data;

  // Autopopulate the weapon's most-recent user when none is picked (overridable).
  useEffect(() => {
    if (userUid == null && ev?.suggestedUserUid != null) setUserUid(ev.suggestedUserUid);
  }, [ev?.suggestedUserUid, userUid]);

  const reset = () => {
    setWeaponUid(null);
    setUserUid(null);
    setNotes('');
  };

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const checkoutMut = useMutation({
    mutationFn: () => doCheckout(weaponUid!, userUid!, operator!.uid, notes || undefined),
    onSuccess: () => {
      notifications.show({ message: t('checked_out_ok') });
      reset();
      qc.invalidateQueries({ queryKey: ['openCheckouts'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
    },
    onError,
  });

  const checkinMut = useMutation({
    mutationFn: (id: number) => doCheckin(id, operator!.uid),
    onSuccess: () => {
      notifications.show({ message: t('returned_ok') });
      qc.invalidateQueries({ queryKey: ['openCheckouts'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
    },
    onError,
  });

  const outMap = new Map(
    (open.data ?? []).map((o) => [o.weaponUid, o.userName ?? ''] as const),
  );

  const weaponData = (weapons.data ?? []).map((w) => {
    const base = [w.displayId, [w.brand, w.model].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');
    const out = outMap.has(w.uid);
    const label = out
      ? `${base} — ${t('held_by', { name: outMap.get(w.uid) })}`
      : !w.active
        ? `${base} (${t('inactive')})`
        : base;
    return { value: String(w.uid), label, disabled: out };
  });

  const userData = (users.data ?? []).map((u) => {
    const base = [u.displayId, u.name, u.memberNumber].filter(Boolean).join(' · ');
    return { value: String(u.uid), label: !u.active ? `${base} (${t('inactive')})` : base };
  });

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      {/* New checkout */}
      <Card withBorder padding="lg">
        <Stack>
          <Title order={3}>{t('checkout_new')}</Title>

          <Select
            label={t('field_weapon')}
            placeholder={t('select_weapon_ph')}
            data={weaponData}
            value={weaponUid != null ? String(weaponUid) : null}
            onChange={(v) => setWeaponUid(v ? Number(v) : null)}
            searchable
            clearable
          />
          <Select
            label={t('field_member')}
            placeholder={t('select_member_ph')}
            data={userData}
            value={userUid != null ? String(userUid) : null}
            onChange={(v) => setUserUid(v ? Number(v) : null)}
            searchable
            clearable
          />

          {/* Banners */}
          {ev?.weaponInactive && (
            <Alert color="red" variant="filled">
              {ev.weaponInactiveReason
                ? t('banner_weapon_inactive', { reason: ev.weaponInactiveReason })
                : t('banner_weapon_inactive_noreason')}
            </Alert>
          )}
          {ev?.weaponAlreadyOut && (
            <Alert color="gray">
              {t('banner_weapon_already_out', { name: ev.openHolderName })}
            </Alert>
          )}
          {ev?.userInactive && (
            <Alert color="red" variant="filled">
              {t('banner_user_inactive')}
            </Alert>
          )}
          {ev != null && ev.userOutstandingDebtKr > 0 && (
            <Alert color="red" variant="filled">
              {t('banner_debt', { amount: ev.userOutstandingDebtKr })}
            </Alert>
          )}
          {ev?.fresherUserName && (
            <Alert color="orange">{t('banner_fresher', { name: ev.fresherUserName })}</Alert>
          )}

          <TextInput
            label={t('field_checkout_notes')}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />

          <Button
            size="lg"
            disabled={!ev?.canCheckout || !operator}
            loading={checkoutMut.isPending}
            onClick={() => checkoutMut.mutate()}
          >
            {t('confirm_checkout')}
          </Button>
        </Stack>
      </Card>

      {/* Open checkouts / checkin */}
      <Card withBorder padding="lg">
        <Stack>
          <Title order={3}>{t('open_checkouts')}</Title>
          {(open.data?.length ?? 0) === 0 ? (
            <Text c="dimmed">{t('no_open_checkouts')}</Text>
          ) : (
            (open.data ?? []).map((o) => (
              <Card key={o.id} withBorder padding="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Text fw={600}>
                      {o.weaponDisplay} {o.weaponLabel && `· ${o.weaponLabel}`}
                    </Text>
                    <Text size="sm">{o.userName}</Text>
                    <Text size="xs" c="dimmed">
                      {t('label_checked_out_at')}: {new Date(o.checkedOutAt).toLocaleString()}
                    </Text>
                  </Stack>
                  <Button
                    variant="light"
                    color="teal"
                    loading={checkinMut.isPending}
                    onClick={() => checkinMut.mutate(o.id)}
                  >
                    {t('return_weapon')}
                  </Button>
                </Group>
              </Card>
            ))
          )}
        </Stack>
      </Card>
    </SimpleGrid>
  );
}
