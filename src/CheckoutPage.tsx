import {
  Card,
  Stack,
  Group,
  SimpleGrid,
  Text,
  Button,
  Badge,
  Checkbox,
  Paper,
  Modal,
} from '@mantine/core';
import { IconUser, IconTargetArrow } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  listUsers,
  listWeapons,
  evaluateCheckout,
  doCheckout,
  lastShotDates,
  outstandingDebts,
  lastWeaponUsers,
  listOpenCheckouts,
  activeTagKeys,
  type Weapon,
  type User,
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { userLabel, weaponLabel } from './labels';
import { fmtDate } from './format';
import { WeaponPickerModal } from './WeaponPickerModal';
import { MemberPickerModal } from './MemberPickerModal';
import { GuestModal } from './GuestModal';
import { Numpad } from './Numpad';

export function CheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  // Weapon-first flow: numpad selector step, then the member/weapon form step.
  const [step, setStep] = useState<'selector' | 'form'>('selector');
  const [tag, setTag] = useState('');
  const [assign, setAssign] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  // Which picker modal is open (replaces the old per-field numpad entry).
  const [picker, setPicker] = useState<'weapon' | 'member' | null>(null);
  const [guestOpen, setGuestOpen] = useState(false);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const shots = useQuery({ queryKey: ['lastShotDates'], queryFn: lastShotDates });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const lastMap = new Map((shots.data ?? []).map((s) => [s.userUid, s.lastShotAt] as const));
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));
  const lastUses = useQuery({ queryKey: ['lastWeaponUsers'], queryFn: lastWeaponUsers });
  const lastUseMap = new Map((lastUses.data ?? []).map((l) => [l.weaponUid, l] as const));
  const openQ = useQuery({ queryKey: ['openCheckouts'], queryFn: listOpenCheckouts });
  const openMap = new Map((openQ.data ?? []).map((o) => [o.weaponUid, o] as const));
  // weapon uid → the member whose favorite it is (at most one; DB-enforced).
  const preferrerMap = new Map(
    (users.data ?? [])
      .filter((u) => u.preferredWeaponUid != null)
      .map((u) => [u.preferredWeaponUid as number, u] as const),
  );

  const evalQ = useQuery({
    queryKey: ['eval', weaponUid, userUid],
    queryFn: () => evaluateCheckout(weaponUid, userUid),
    enabled: weaponUid != null || userUid != null,
  });
  const ev = evalQ.data;

  // Selector step: tag → matched active weapon, and its auto-resolved member
  // (assigned member first, else last borrower — never a guest).
  const matched = tag ? (weapons.data ?? []).find((w) => w.active && w.displayId === tag) : undefined;
  const autoUserFor = (w: Weapon): User | undefined => {
    const p = preferrerMap.get(w.uid);
    if (p?.active) return p;
    const last = lastUseMap.get(w.uid);
    const u = last && (users.data ?? []).find((x) => x.uid === last.userUid);
    return u && u.active && !u.isGuest ? u : undefined;
  };
  const holder = matched ? openMap.get(matched.uid) : undefined;
  // Auto-resolved user for the selector preview + direct checkout, and
  // whether they're the assigned (preferred) holder vs. last-used.
  const autoUser = matched ? autoUserFor(matched) : undefined;
  const autoUserIsAssigned =
    autoUser != null && matched != null && preferrerMap.get(matched.uid)?.uid === autoUser.uid;
  const canDirectCheckout = !!matched && !holder && autoUser != null && !!operator;

  const enterForm = (w: Weapon | undefined, uid: number | null) => {
    setWeaponUid(w?.uid ?? null);
    setUserUid(uid);
    setAssign(false);
    setStep('form');
  };

  // Physical-keyboard entry for the selector. The page Stack never holds
  // focus, so a React onKeyDown would be dead — listen on window while the
  // selector shows. Suspended while the guest modal is open so digits typed
  // into the SSN field don't leak into the tag.
  useEffect(() => {
    if (step !== 'selector' || guestOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') setTag((v) => v + e.key);
      else if (e.key === 'Backspace') setTag((v) => v.slice(0, -1));
      else if (e.key === 'Enter') {
        if (canDirectCheckout && matched && autoUser) {
          checkoutMut.mutate({ weaponUid: matched.uid, userUid: autoUser.uid, assign: false });
        } else if (matched && !holder) {
          enterForm(matched, autoUser?.uid ?? null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Member drives the flow: picking a member autofills their suggested weapon
  // (assigned, else last-used) or clears the field when nothing is available.
  // The ASSIGNED weapon is selected even while checked out — the card then
  // shows the out-error with the holder; a last-used suggestion is still
  // skipped when out (no assignment claim to surface).
  // A scanned weapon (from the selector step) is never clobbered by a member pick.
  const onMemberChange = async (uid: number) => {
    setAssign(false);
    if (weaponUid != null) {
      setUserUid(uid);
      return;
    }
    setUserUid(uid);
    const e = await evaluateCheckout(null, uid);
    const assignedUid = (users.data ?? []).find((u) => u.uid === uid)?.preferredWeaponUid;
    const isAssigned = e.suggestedWeaponUid != null && e.suggestedWeaponUid === assignedUid;
    setWeaponUid(
      e.suggestedWeaponUid != null && (isAssigned || !e.suggestedWeaponOut)
        ? e.suggestedWeaponUid
        : null,
    );
  };

  const reset = () => {
    setWeaponUid(null);
    setUserUid(null);
    setStep('selector');
    setTag('');
    setAssign(false);
  };

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const selectedWeapon = (weapons.data ?? []).find((w) => w.uid === weaponUid);
  const selectedUser = (users.data ?? []).find((u) => u.uid === userUid);
  const alreadyAssigned = selectedWeapon != null && selectedWeapon.uid === selectedUser?.preferredWeaponUid;

  const checkoutMut = useMutation({
    mutationFn: (vars: { weaponUid: number; userUid: number; assign: boolean }) =>
      doCheckout(vars.weaponUid, vars.userUid, operator!.uid, vars.assign),
    onSuccess: () => {
      notifications.show({ message: t('checked_out_ok') });
      reset();
      qc.invalidateQueries({ queryKey: ['openCheckouts'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
      qc.invalidateQueries({ queryKey: ['lastWeaponUsers'] });
      qc.invalidateQueries({ queryKey: ['lastShotDates'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError,
  });

  // Pin data for the weapon picker AND the selected-weapon card badges:
  // preferred from the selected member, last-used from the member-only eval
  // (weapon deliberately null).
  const pinEval = useQuery({
    queryKey: ['eval', null, userUid],
    queryFn: () => evaluateCheckout(null, userUid),
    enabled: userUid != null,
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
        name: userLabel(ev.openHolderName, ev.openHolderActive, t),
      });
    }
    return undefined;
  })();

  const memberError: string | undefined =
    ev?.userInactive ? t('banner_user_inactive') : undefined;

  const weaponWarning: string | undefined =
    ev && ev.weaponTags.length > 0
      ? t('warning_weapon_tagged', {
          tags: ev.weaponTags.map((k) => t(`tag_${k}`)).join(', '),
        }) + (ev.weaponTagComment ? ` — ${ev.weaponTagComment}` : '')
      : undefined;

  // Another member's favorite — flag loudly before it leaves the rack.
  const otherFavorite = (() => {
    if (!selectedWeapon) return undefined;
    const p = preferrerMap.get(selectedWeapon.uid);
    return p && p.uid !== selectedUser?.uid ? p : undefined;
  })();

  // The member's own current assignment, when checking the box would replace
  // it with a different weapon (one assigned weapon per member).
  const replacesOwnAssigned = (() => {
    if (!selectedUser || alreadyAssigned || selectedUser.preferredWeaponUid == null)
      return undefined;
    return (weapons.data ?? []).find((w) => w.uid === selectedUser.preferredWeaponUid);
  })();

  if (step === 'selector') {
    return (
      <Stack
        align="center"
        justify="center"
        style={{ height: 'calc(100vh - 144px)' }}
      >
        <Group align="stretch" gap="xl">
          <Stack w={360} gap="md">
            <Numpad value={tag} onChange={setTag} size="xl" placeholder={t('enter_weapon_id')} />
            <Paper withBorder p="md" ta="center">
              {matched ? (
                <Stack gap={4}>
                  <Text fw={700} fz="lg" c="teal">
                    {weaponLabel(
                      matched.brand,
                      matched.model,
                      matched.caliber,
                      matched.displayId,
                      matched.active,
                      t,
                    )}
                  </Text>
                  {autoUser && (
                    <Stack gap={2} align="center">
                      <Group gap={4} justify="center">
                        <Text c="dimmed">
                          {userLabel(autoUser.name, autoUser.active, t, autoUser.isGuest)}
                        </Text>
                        <Badge color={autoUserIsAssigned ? 'yellow' : 'gray'} variant="light" size="sm">
                          {autoUserIsAssigned ? t('badge_preferred') : t('badge_last')}
                        </Badge>
                      </Group>
                      {lastMap.has(autoUser.uid) && (
                        <Text size="sm" c="dimmed">
                          {t('field_last_shot')}: {fmtDate(lastMap.get(autoUser.uid)!)}
                        </Text>
                      )}
                      {debtMap.has(autoUser.uid) && (
                        <Badge color="red" variant="filled" size="sm">
                          {t('debt_badge', { amount: debtMap.get(autoUser.uid) })}
                        </Badge>
                      )}
                    </Stack>
                  )}
                  {holder && (
                    <Text c="orange" fw={600}>
                      {t('banner_weapon_already_out', {
                        name: userLabel(holder.userName, holder.userActive, t, holder.userIsGuest),
                      })}
                    </Text>
                  )}
                </Stack>
              ) : (
                <Text c="dimmed">{tag ? t('no_match') : ' '}</Text>
              )}
            </Paper>
            <Button
              size="xl"
              fullWidth
              disabled={!canDirectCheckout}
              loading={checkoutMut.isPending}
              onClick={() =>
                matched &&
                autoUser &&
                checkoutMut.mutate({ weaponUid: matched.uid, userUid: autoUser.uid, assign: false })
              }
            >
              {t('confirm_checkout')}
            </Button>
          </Stack>
          {/* Secondary paths on the right, bottom-aligned with the confirm button. */}
          <Stack w={280} gap="md" justify="flex-end">
            <Button
              size="xl"
              variant="default"
              fullWidth
              onClick={() =>
                matched && !holder
                  ? enterForm(matched, autoUser?.uid ?? null)
                  : enterForm(undefined, null)
              }
            >
              {matched && !holder ? t('change') : t('browse_weapons')}
            </Button>
            <Button size="xl" variant="default" fullWidth onClick={() => setGuestOpen(true)}>
              {t('guest_button')}
            </Button>
          </Stack>
        </Group>

        <GuestModal
          opened={guestOpen}
          onClose={() => setGuestOpen(false)}
          onSelect={(uid) => {
            if (matched) {
              enterForm(matched, uid);
            } else {
              setStep('form');
              onMemberChange(uid);
            }
          }}
        />
      </Stack>
    );
  }

  return (
    // Fill the shell (100vh − 64 header − 48 footer − 2×16 main padding) so the
    // cards grow into the free space instead of leaving a void under the button.
    <Stack gap="lg" style={{ height: 'calc(100vh - 144px)' }}>
      {/* 2×2 grid: label row + card row. Grid rows keep the two columns
          aligned no matter how tall the header content (Guest button) or card
          content gets — flex-based equalization drifted here before. */}
      <SimpleGrid
        cols={2}
        spacing="lg"
        verticalSpacing={4}
        style={{ flex: 1, minHeight: 0, gridTemplateRows: 'auto 1fr' }}
      >
        <Group justify="space-between" align="center">
          <Text fw={600}>{t('field_member')}</Text>
          <Button variant="default" onClick={() => setGuestOpen(true)}>
            {t('guest_button')}
          </Button>
        </Group>
        <Group align="center">
          <Text fw={600}>{t('field_weapon')}</Text>
        </Group>
          <Card
            withBorder
            padding="lg"
            mih={140}
            h="100%"
            onClick={() => setPicker('member')}
            style={{
              cursor: 'pointer',
              ...(selectedUser
                ? {}
                : { borderStyle: 'dashed' }),
              ...(memberError ? { borderColor: 'var(--mantine-color-red-6)' } : {}),
            }}
          >
            {selectedUser ? (
              <Stack gap="sm" justify="center" h="100%">
                <Text fz={32} fw={700}>
                  {userLabel(selectedUser.name, selectedUser.active, t, selectedUser.isGuest)}
                </Text>
                {lastMap.has(selectedUser.uid) && (
                  <Text size="lg" c="dimmed">
                    {t('field_last_shot')}: {fmtDate(lastMap.get(selectedUser.uid)!)}
                  </Text>
                )}
                {debtMap.has(selectedUser.uid) && (
                  <Badge color="red" variant="filled" size="lg">
                    {t('debt_badge', { amount: debtMap.get(selectedUser.uid) })}
                  </Badge>
                )}
                {memberError && (
                  <Text fz="lg" c="red">
                    {memberError}
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack align="center" justify="center" h="100%" gap="xs" c="dimmed">
                <IconUser size={48} />
                <Text fz="lg">{t('select_member_ph')}</Text>
              </Stack>
            )}
          </Card>

          <Card
            withBorder
            padding="lg"
            mih={140}
            h="100%"
            onClick={() => setPicker('weapon')}
            style={{
              cursor: 'pointer',
              ...(selectedWeapon
                ? {}
                : { borderStyle: 'dashed' }),
              ...(weaponError
                ? { borderColor: 'var(--mantine-color-red-6)' }
                : otherFavorite
                  ? { borderColor: 'var(--mantine-color-yellow-6)', borderWidth: 2 }
                  : {}),
            }}
          >
            {selectedWeapon ? (
              <Stack gap="sm" justify="center" h="100%">
                <Text fz={32} fw={700}>
                  {weaponLabel(
                    selectedWeapon.brand,
                    selectedWeapon.model,
                    selectedWeapon.caliber,
                    selectedWeapon.displayId,
                    selectedWeapon.active,
                    t,
                  )}
                </Text>
                {/* Own badge row under the name — full badge text, wraps freely. */}
                {(selectedWeapon.uid === selectedUser?.preferredWeaponUid ||
                  otherFavorite ||
                  selectedWeapon.uid === pinEval.data?.lastWeaponUid) && (
                  <Group gap={4}>
                    {selectedWeapon.uid === selectedUser?.preferredWeaponUid ? (
                      <Badge color="yellow" variant="light" size="lg" style={{ flexShrink: 0 }}>
                        ★ {t('badge_preferred')}
                      </Badge>
                    ) : otherFavorite ? (
                      <Badge color="yellow" variant="filled" size="lg" style={{ flexShrink: 0 }}>
                        ★ {otherFavorite.name}
                      </Badge>
                    ) : null}
                    {selectedWeapon.uid === pinEval.data?.lastWeaponUid && (
                      <Badge color="gray" variant="light" size="lg" style={{ flexShrink: 0 }}>
                        {t('badge_last')}
                      </Badge>
                    )}
                  </Group>
                )}
                {activeTagKeys(selectedWeapon).length > 0 && (
                  <Group gap={4}>
                    {activeTagKeys(selectedWeapon).map((k) => (
                      <Badge key={k} color="orange" variant="light" size="sm">
                        {t(`tag_${k}`)}
                      </Badge>
                    ))}
                  </Group>
                )}
                {!ev?.weaponAlreadyOut && lastUseMap.has(selectedWeapon.uid) && (
                  <Text size="lg" c="dimmed">
                    {t('picker_last_used', {
                      name: userLabel(
                        lastUseMap.get(selectedWeapon.uid)!.userName,
                        lastUseMap.get(selectedWeapon.uid)!.userActive,
                        t,
                      ),
                      date: fmtDate(lastUseMap.get(selectedWeapon.uid)!.lastUsedAt),
                    })}
                  </Text>
                )}
                {weaponError && (
                  <Text fz="lg" c="red">
                    {weaponError}
                  </Text>
                )}
                {weaponWarning && (
                  <Text fz="lg" c="orange">
                    {weaponWarning}
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack align="center" justify="center" h="100%" gap="xs" c="dimmed">
                <IconTargetArrow size={48} />
                <Text fz="lg">{t('select_weapon_ph')}</Text>
              </Stack>
            )}
          </Card>
      </SimpleGrid>

      {selectedUser && selectedWeapon && !selectedUser.isGuest && (
        <Checkbox
          size="lg"
          label={t('assign_weapon_checkbox')}
          checked={alreadyAssigned || assign}
          disabled={alreadyAssigned}
          onChange={(e) => {
            const checked = e.target.checked;
            // Taking another member's weapon, or replacing this member's own
            // assignment, needs explicit yes/no before the box sticks.
            if (checked && (otherFavorite || replacesOwnAssigned)) setConfirmTransfer(true);
            else setAssign(checked);
          }}
        />
      )}

      <Button
        size="xl"
        mih={72}
        fullWidth
        disabled={!ev?.canCheckout || !operator}
        loading={checkoutMut.isPending}
        onClick={() =>
          checkoutMut.mutate({
            weaponUid: weaponUid!,
            userUid: userUid!,
            assign: alreadyAssigned ? false : assign,
          })
        }
      >
        {t('confirm_checkout')}
      </Button>

      <MemberPickerModal
        opened={picker === 'member'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          onMemberChange(uid);
        }}
      />

      <GuestModal
        opened={guestOpen}
        onClose={() => setGuestOpen(false)}
        onSelect={(uid) => onMemberChange(uid)}
      />

      <WeaponPickerModal
        opened={picker === 'weapon'}
        onClose={() => setPicker(null)}
        onSelect={(uid) => {
          setPicker(null);
          setAssign(false);
          setWeaponUid(uid);
        }}
        availableOnly
        pinned={{
          preferredUid: selectedUser?.preferredWeaponUid,
          lastUid: pinEval.data?.lastWeaponUid,
        }}
      />

      <Modal
        opened={confirmTransfer}
        onClose={() => setConfirmTransfer(false)}
        title={t('assign_weapon_checkbox')}
        centered
      >
        <Stack>
          {otherFavorite && (
            <Text fz="lg">{t('assign_transfer_confirm', { name: otherFavorite.name })}</Text>
          )}
          {replacesOwnAssigned && (
            <Text fz="lg">
              {t('assign_replace_confirm', {
                weapon: weaponLabel(
                  replacesOwnAssigned.brand,
                  replacesOwnAssigned.model,
                  replacesOwnAssigned.caliber,
                  replacesOwnAssigned.displayId,
                  replacesOwnAssigned.active,
                  t,
                ),
              })}
            </Text>
          )}
          <Text fz="lg" fw={600}>
            {t('are_you_sure')}
          </Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setConfirmTransfer(false)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              color="orange"
              onClick={() => {
                setAssign(true);
                setConfirmTransfer(false);
              }}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
