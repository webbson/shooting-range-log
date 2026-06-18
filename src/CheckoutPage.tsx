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
  const [fastCheckinOpen, setFastCheckinOpen] = useState(false);

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
    if (uid != null) {
      const e = await evaluateCheckout(null, uid);
      if (e.suggestedWeaponUid != null) setWeaponUid(e.suggestedWeaponUid);
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
  // are offered for checkout. If an unavailable item is selected (e.g. via numpad),
  // append it so the closed Select still renders its label.
  const weaponData = (weapons.data ?? [])
    .filter((w) => w.active && !outMap.has(w.uid))
    .map((w) => ({
      value: String(w.uid),
      label: weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t),
    }));
  if (weaponUid != null && !weaponData.some((d) => d.value === String(weaponUid))) {
    const w = (weapons.data ?? []).find((x) => x.uid === weaponUid);
    if (w) weaponData.push({ value: String(w.uid), label: weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t) });
  }

  const userData = (users.data ?? [])
    .filter((u) => u.active)
    .map((u) => ({
      value: String(u.uid),
      label: userLabel(u.name, u.displayId, true, t),
    }));
  if (userUid != null && !userData.some((d) => d.value === String(userUid))) {
    const u = (users.data ?? []).find((x) => x.uid === userUid);
    if (u) userData.push({ value: String(u.uid), label: userLabel(u.name, u.displayId, u.active, t) });
  }

  // Resolve an entered tag (display_id) against all known weapons/members.
  // Inactive and loaned-out items match too — the eval will surface an error state.
  const matchId = (id: string): { uid: number; label: string } | null => {
    if (numpad === 'weapon') {
      const w = (weapons.data ?? []).find((x) => x.displayId === id);
      return w ? { uid: w.uid, label: weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t) } : null;
    }
    if (numpad === 'member') {
      const u = (users.data ?? []).find((x) => x.displayId === id);
      return u ? { uid: u.uid, label: userLabel(u.name, u.displayId, u.active, t) } : null;
    }
    return null;
  };

  // Embedded notices — attached directly to the relevant Select instead of free-floating banners.
  const weaponError: string | undefined = (() => {
    if (!ev) return undefined;
    if (ev.weaponInactive) {
      return ev.weaponInactiveReason
        ? t('banner_weapon_inactive', { reason: ev.weaponInactiveReason })
        : t('banner_weapon_inactive_noreason');
    }
    if (ev.weaponAlreadyOut) {
      return t('banner_weapon_already_out', {
        name: userLabel(ev.openHolderName, ev.openHolderDisplay, ev.openHolderActive, t),
      });
    }
    return undefined;
  })();

  const weaponDescription: string | undefined =
    weaponUid != null && ev?.fresherUserName
      ? t('banner_fresher', {
          name: userLabel(ev.fresherUserName, ev.fresherUserDisplay, ev.fresherUserActive, t),
          date: ev.fresherUserAt ? fmtDateTime(ev.fresherUserAt) : '',
        })
      : undefined;

  const memberError: string | undefined =
    ev?.userInactive ? t('banner_user_inactive') : undefined;

  const memberDescription: string | undefined =
    userUid != null && ev != null && ev.userOutstandingDebtKr > 0
      ? t('banner_debt', { amount: ev.userOutstandingDebtKr })
      : undefined;

  // Drive the existing change handlers so autopopulate + eval behave like a dropdown pick.
  const onNumpadSubmit = (id: string) => {
    const m = matchId(id);
    if (!m) return;
    if (numpad === 'weapon') onWeaponChange(String(m.uid));
    else onMemberChange(String(m.uid));
    setNumpad(null);
  };

  const matchCheckin = (id: string): React.ReactNode | null => {
    const o = (open.data ?? []).find((x) => x.weaponDisplayId === id);
    if (!o) return null;
    return (
      <Stack gap={2}>
        <Text fw={600} c="teal">
          {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, o.weaponDisplayId, o.weaponActive, t)}
        </Text>
        <Text size="sm">
          {userLabel(o.userName, o.userDisplayId, o.userActive, t)}
        </Text>
        <Text size="xs" c="dimmed">
          {t('label_checked_out_at')}: {fmtDateTime(o.checkedOutAt)}
        </Text>
      </Stack>
    );
  };

  const onFastCheckinSubmit = (id: string) => {
    const o = (open.data ?? []).find((x) => x.weaponDisplayId === id);
    if (o) {
      checkinMut.mutate(o.id);
      setFastCheckinOpen(false);
    }
  };

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      {/* New checkout */}
      <Card withBorder padding="lg">
        <Stack>
          <Title order={3}>{t('checkout_new')}</Title>

          <Stack gap={4}>
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
                error={!!memberError}
              />
              <Tooltip label={t('enter_id')}>
                <Button variant="default" fz={26} px="md" aria-label={t('enter_id')} onClick={() => setNumpad('member')}>
                  ⌨
                </Button>
              </Tooltip>
            </Group>
            {memberDescription && <Text fz="xs" c="orange.7">{memberDescription}</Text>}
            {memberError && <Text fz="xs" c="red">{memberError}</Text>}
          </Stack>
          <Stack gap={4}>
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
                error={!!weaponError}
              />
              <Tooltip label={t('enter_id')}>
                <Button variant="default" fz={26} px="md" aria-label={t('enter_id')} onClick={() => setNumpad('weapon')}>
                  ⌨
                </Button>
              </Tooltip>
            </Group>
            {weaponDescription && <Text fz="xs" c="orange.7">{weaponDescription}</Text>}
            {weaponError && <Text fz="xs" c="red">{weaponError}</Text>}
          </Stack>

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
          <Group justify="space-between" align="center">
            <Title order={3}>{t('open_checkouts')}</Title>
            <Button variant="default" onClick={() => setFastCheckinOpen(true)}>
              {t('fast_checkin')}
            </Button>
          </Group>
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

      <IdNumpadModal
        opened={fastCheckinOpen}
        title={t('fast_checkin')}
        match={matchCheckin}
        confirmLabel={t('return_weapon')}
        onClose={() => setFastCheckinOpen(false)}
        onSubmit={onFastCheckinSubmit}
      />
    </SimpleGrid>
  );
}
