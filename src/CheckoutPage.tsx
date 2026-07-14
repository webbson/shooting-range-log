import {
  SimpleGrid,
  Card,
  Stack,
  Group,
  Title,
  Text,
  Input,
  CloseButton,
  TextInput,
  Button,
  Alert,
  ActionIcon,
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
  setPreferredWeapon,
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';
import { DebtModal } from './DebtModal';
import { IdNumpadModal } from './IdNumpadModal';
import { WeaponPickerModal } from './WeaponPickerModal';
import { MemberPickerModal } from './MemberPickerModal';

export function CheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [debtUser, setDebtUser] = useState<{ uid: number; name: string } | null>(null);
  // Which picker modal is open (replaces the old per-field numpad entry).
  const [picker, setPicker] = useState<'weapon' | 'member' | null>(null);
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
  const onWeaponChange = async (wid: number | null) => {
    setWeaponUid(wid);
    if (wid != null && userUid == null) {
      const e = await evaluateCheckout(wid, null);
      if (e.suggestedUserUid != null && !e.suggestedUserBusy) setUserUid(e.suggestedUserUid);
    }
  };

  const onMemberChange = async (uid: number | null) => {
    setUserUid(uid);
    if (uid != null) {
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

  // Star button: weapon can be one member's favorite. Setting replaces the
  // borrower's previous favorite; tapping their own filled star clears it.
  const favMut = useMutation({
    mutationFn: (args: { userUid: number; weaponUid: number | null }) =>
      setPreferredWeapon(args.userUid, args.weaponUid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
    },
    onError,
  });

  const preferrerOf = (weaponUid: number) =>
    (users.data ?? []).find((u) => u.preferredWeaponUid === weaponUid);

  const selectedWeapon = (weapons.data ?? []).find((w) => w.uid === weaponUid);
  const selectedUser = (users.data ?? []).find((u) => u.uid === userUid);

  // Pin data for the weapon picker: preferred from the selected member,
  // last-used from the member-only eval (weapon deliberately null).
  const pinEval = useQuery({
    queryKey: ['eval', null, userUid],
    queryFn: () => evaluateCheckout(null, userUid),
    enabled: picker === 'weapon' && userUid != null,
  });

  // Embedded notices — attached directly to the relevant field instead of free-floating banners.
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
              <Input.Wrapper label={t('field_member')} style={{ flex: 1 }}>
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  onClick={() => setPicker('member')}
                  styles={memberError ? { root: { borderColor: 'var(--mantine-color-red-6)' } } : undefined}
                  c={selectedUser ? undefined : 'dimmed'}
                >
                  {selectedUser
                    ? userLabel(selectedUser.name, selectedUser.displayId, selectedUser.active, t)
                    : t('select_member_ph')}
                </Button>
              </Input.Wrapper>
              {userUid != null && (
                <CloseButton
                  size="lg"
                  aria-label={t('clear_selection')}
                  onClick={() => setUserUid(null)}
                />
              )}
            </Group>
            {memberDescription && <Text fz="xs" c="orange.7">{memberDescription}</Text>}
            {memberError && <Text fz="xs" c="red">{memberError}</Text>}
          </Stack>
          <Stack gap={4}>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Input.Wrapper label={t('field_weapon')} style={{ flex: 1 }}>
                <Button
                  fullWidth
                  variant="default"
                  justify="space-between"
                  rightSection="▾"
                  onClick={() => setPicker('weapon')}
                  styles={weaponError ? { root: { borderColor: 'var(--mantine-color-red-6)' } } : undefined}
                  c={selectedWeapon ? undefined : 'dimmed'}
                >
                  {selectedWeapon
                    ? weaponLabel(
                        selectedWeapon.brand,
                        selectedWeapon.model,
                        selectedWeapon.caliber,
                        selectedWeapon.displayId,
                        selectedWeapon.active,
                        t,
                      )
                    : t('select_weapon_ph')}
                </Button>
              </Input.Wrapper>
              {weaponUid != null && (
                <CloseButton
                  size="lg"
                  aria-label={t('clear_selection')}
                  onClick={() => setWeaponUid(null)}
                />
              )}
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
                    {(() => {
                      const p = preferrerOf(o.weaponUid);
                      if (p && p.uid !== o.userUid) return null; // another member's favorite
                      const mine = p != null;
                      return (
                        <Tooltip label={mine ? t('unmark_favorite') : t('mark_favorite')}>
                          <ActionIcon
                            variant={mine ? 'light' : 'subtle'}
                            color="yellow"
                            size="lg"
                            aria-label={mine ? t('unmark_favorite') : t('mark_favorite')}
                            onClick={() =>
                              favMut.mutate({
                                userUid: o.userUid,
                                weaponUid: mine ? null : o.weaponUid,
                              })
                            }
                          >
                            {mine ? '★' : '☆'}
                          </ActionIcon>
                        </Tooltip>
                      );
                    })()}
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

      <MemberPickerModal
        opened={picker === 'member'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          onMemberChange(uid);
        }}
      />

      <WeaponPickerModal
        opened={picker === 'weapon'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          onWeaponChange(uid);
        }}
        availableOnly
        pinned={{
          preferredUid: selectedUser?.preferredWeaponUid,
          lastUid: pinEval.data?.lastWeaponUid,
        }}
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
