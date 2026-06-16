import {
  SimpleGrid,
  Card,
  Stack,
  Group,
  Title,
  Text,
  Select,
  TextInput,
  NumberInput,
  Button,
  Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  listUsers,
  listWeapons,
  listOpenCheckouts,
  evaluateCheckout,
  doCheckout,
  doCheckin,
  addDebt,
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
  const [debtAmount, setDebtAmount] = useState<number | string>('');
  const [debtReason, setDebtReason] = useState('');

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const open = useQuery({ queryKey: ['openCheckouts'], queryFn: listOpenCheckouts });

  const evalQ = useQuery({
    queryKey: ['eval', weaponUid, userUid],
    queryFn: () => evaluateCheckout(weaponUid, userUid),
    enabled: weaponUid != null || userUid != null,
  });
  const ev = evalQ.data;

  // Autopopulate happens once, on explicit selection (not reactively) — so a
  // manual clear sticks instead of being re-filled. We skip autofill when the
  // suggested counterpart is unavailable (busy member / weapon already out);
  // the reactive eval below surfaces a warning banner for that case.
  const onWeaponChange = async (v: string | null) => {
    const wid = v ? Number(v) : null;
    setWeaponUid(wid);
    if (wid != null && userUid == null) {
      const e = await evaluateCheckout(wid, null);
      if (e.suggestedUserUid != null && !e.suggestedUserBusy) setUserUid(e.suggestedUserUid);
    }
  };

  const onMemberChange = async (v: string | null) => {
    const uid = v ? Number(v) : null;
    setUserUid(uid);
    if (uid != null && weaponUid == null) {
      const e = await evaluateCheckout(null, uid);
      if (e.suggestedWeaponUid != null && !e.suggestedWeaponOut)
        setWeaponUid(e.suggestedWeaponUid);
    }
  };

  const reset = () => {
    setWeaponUid(null);
    setUserUid(null);
    setNotes('');
    setDebtAmount('');
    setDebtReason('');
  };

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const checkoutMut = useMutation({
    mutationFn: async () => {
      const c = await doCheckout(weaponUid!, userUid!, operator!.uid, notes || undefined);
      // Optionally record a debt incurred at this checkout.
      if (debtAmount && Number(debtAmount) > 0) {
        await addDebt(userUid!, operator!.uid, Number(debtAmount), debtReason || undefined, c.id);
      }
      return c;
    },
    onSuccess: () => {
      notifications.show({ message: t('checked_out_ok') });
      reset();
      qc.invalidateQueries({ queryKey: ['openCheckouts'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
      qc.invalidateQueries({ queryKey: ['outstandingDebts'] });
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
            onChange={onWeaponChange}
            searchable
            clearable
          />
          <Select
            label={t('field_member')}
            placeholder={t('select_member_ph')}
            data={userData}
            value={userUid != null ? String(userUid) : null}
            onChange={onMemberChange}
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
          {weaponUid != null && userUid == null && ev?.suggestedUserBusy && (
            <Alert color="orange">
              {t('banner_suggested_user_busy', { name: ev.suggestedUserName })}
            </Alert>
          )}
          {userUid != null && weaponUid == null && ev?.suggestedWeaponOut && (
            <Alert color="orange">
              {t('banner_suggested_weapon_out', { label: ev.suggestedWeaponLabel })}
            </Alert>
          )}

          <TextInput
            label={t('field_checkout_notes')}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />

          <Group align="flex-end" grow>
            <NumberInput
              label={t('checkout_debt')}
              value={debtAmount}
              onChange={setDebtAmount}
              min={0}
              allowDecimal={false}
              suffix=" kr"
            />
            <TextInput
              label={t('field_reason')}
              value={debtReason}
              onChange={(e) => setDebtReason(e.currentTarget.value)}
            />
          </Group>

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
