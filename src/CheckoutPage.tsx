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
  Tooltip,
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
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';
import { DebtModal } from './DebtModal';
import { IdNumpadModal } from './IdNumpadModal';

export function CheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [debtUser, setDebtUser] = useState<{ uid: number; name: string } | null>(null);
  // Numpad ID entry (touch alternative to the dropdowns).
  const [numpad, setNumpad] = useState<'weapon' | 'member' | null>(null);

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

  // Only available weapons (active and not currently out) and active members
  // are offered for checkout.
  const weaponData = (weapons.data ?? [])
    .filter((w) => w.active && !outMap.has(w.uid))
    .map((w) => ({
      value: String(w.uid),
      label: weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t),
    }));

  const userData = (users.data ?? [])
    .filter((u) => u.active)
    .map((u) => ({
      value: String(u.uid),
      label: userLabel(u.name, u.displayId, true, t),
    }));

  // Resolve an entered tag (display_id) against the same pool the dropdown offers.
  // Used both for the modal's live match preview and for confirming the pick.
  const matchId = (id: string): { uid: number; label: string } | null => {
    if (numpad === 'weapon') {
      const w = (weapons.data ?? []).find(
        (x) => x.active && !outMap.has(x.uid) && x.displayId === id,
      );
      return w ? { uid: w.uid, label: weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t) } : null;
    }
    if (numpad === 'member') {
      const u = (users.data ?? []).find((x) => x.active && x.displayId === id);
      return u ? { uid: u.uid, label: userLabel(u.name, u.displayId, true, t) } : null;
    }
    return null;
  };

  // Drive the existing change handlers so autopopulate + eval behave like a dropdown pick.
  const onNumpadSubmit = (id: string) => {
    const m = matchId(id);
    if (!m) return;
    if (numpad === 'weapon') onWeaponChange(String(m.uid));
    else onMemberChange(String(m.uid));
    setNumpad(null);
  };

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      {/* New checkout */}
      <Card withBorder padding="lg">
        <Stack>
          <Title order={3}>{t('checkout_new')}</Title>

          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Select
              label={t('field_weapon')}
              placeholder={t('select_weapon_ph')}
              data={weaponData}
              value={weaponUid != null ? String(weaponUid) : null}
              onChange={onWeaponChange}
              searchable
              clearable
              style={{ flex: 1 }}
            />
            <Tooltip label={t('enter_id')}>
              <Button variant="default" fz={26} px="md" aria-label={t('enter_id')} onClick={() => setNumpad('weapon')}>
                ⌨
              </Button>
            </Tooltip>
          </Group>
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Select
              label={t('field_member')}
              placeholder={t('select_member_ph')}
              data={userData}
              value={userUid != null ? String(userUid) : null}
              onChange={onMemberChange}
              searchable
              clearable
              style={{ flex: 1 }}
            />
            <Tooltip label={t('enter_id')}>
              <Button variant="default" fz={26} px="md" aria-label={t('enter_id')} onClick={() => setNumpad('member')}>
                ⌨
              </Button>
            </Tooltip>
          </Group>

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
              {t('banner_weapon_already_out', {
                name: userLabel(
                  ev.openHolderName,
                  ev.openHolderDisplay,
                  ev.openHolderActive,
                  t,
                ),
              })}
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
            <Alert color="orange">
              {t('banner_fresher', {
                name: userLabel(
                  ev.fresherUserName,
                  ev.fresherUserDisplay,
                  ev.fresherUserActive,
                  t,
                ),
                date: ev.fresherUserAt ? fmtDateTime(ev.fresherUserAt) : '',
              })}
            </Alert>
          )}
          {weaponUid != null && userUid == null && ev?.suggestedUserBusy && (
            <Alert color="orange">
              {t('banner_suggested_user_busy', {
                name: userLabel(
                  ev.suggestedUserName,
                  ev.suggestedUserDisplayId,
                  ev.suggestedUserActive,
                  t,
                ),
              })}
            </Alert>
          )}
          {userUid != null && weaponUid == null && ev?.suggestedWeaponOut && (
            <Alert color="orange">
              {t('banner_suggested_weapon_out', {
                label: weaponLabel(
                  ev.suggestedWeaponBrand,
                  ev.suggestedWeaponModel,
                  ev.suggestedWeaponCaliber,
                  ev.suggestedWeaponDisplayId,
                  ev.suggestedWeaponActive,
                  t,
                ),
              })}
            </Alert>
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
                      {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, o.weaponDisplayId, o.weaponActive, t)}
                    </Text>
                    <Text size="sm">
                      {userLabel(o.userName, o.userDisplayId, o.userActive, t)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t('label_checked_out_at')}: {fmtDateTime(o.checkedOutAt)}
                    </Text>
                  </Stack>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        setDebtUser({
                          uid: o.userUid,
                          name: userLabel(o.userName, o.userDisplayId, o.userActive, t),
                        })
                      }
                    >
                      {t('add_debt')}
                    </Button>
                    <Button
                      variant="light"
                      color="teal"
                      loading={checkinMut.isPending}
                      onClick={() => checkinMut.mutate(o.id)}
                    >
                      {t('return_weapon')}
                    </Button>
                  </Group>
                </Group>
              </Card>
            ))
          )}
        </Stack>
      </Card>

      <DebtModal
        userUid={debtUser?.uid ?? null}
        userName={debtUser?.name ?? ''}
        opened={debtUser != null}
        onClose={() => setDebtUser(null)}
      />

      <IdNumpadModal
        opened={numpad != null}
        title={numpad === 'member' ? t('field_member') : t('field_weapon')}
        match={(id) => matchId(id)?.label ?? null}
        onClose={() => setNumpad(null)}
        onSubmit={onNumpadSubmit}
      />
    </SimpleGrid>
  );
}
