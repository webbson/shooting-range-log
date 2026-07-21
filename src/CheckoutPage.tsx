import {
  Card,
  Stack,
  Group,
  Title,
  Text,
  Input,
  TextInput,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { listUsers, listWeapons, evaluateCheckout, doCheckout } from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { userLabel, weaponLabel } from './labels';
import { WeaponPickerModal } from './WeaponPickerModal';
import { MemberPickerModal } from './MemberPickerModal';

export function CheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  // Which picker modal is open (replaces the old per-field numpad entry).
  const [picker, setPicker] = useState<'weapon' | 'member' | null>(null);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const evalQ = useQuery({
    queryKey: ['eval', weaponUid, userUid],
    queryFn: () => evaluateCheckout(weaponUid, userUid),
    enabled: weaponUid != null || userUid != null,
  });
  const ev = evalQ.data;

  // Member drives the flow: picking a member autofills their suggested weapon
  // (preferred, else last-used) or clears the field when nothing is available.
  const onMemberChange = async (uid: number) => {
    setUserUid(uid);
    const e = await evaluateCheckout(null, uid);
    setWeaponUid(
      e.suggestedWeaponUid != null && !e.suggestedWeaponOut ? e.suggestedWeaponUid : null,
    );
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
      qc.invalidateQueries({ queryKey: ['lastWeaponUsers'] });
      qc.invalidateQueries({ queryKey: ['lastShotDates'] });
    },
    onError,
  });

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

  const memberError: string | undefined =
    ev?.userInactive ? t('banner_user_inactive') : undefined;

  return (
    <Card withBorder padding="lg" maw={560} mx="auto">
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
          </Group>
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
                disabled={userUid == null}
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
          </Group>
          {userUid == null && (
            <Text fz="xs" c="dimmed">
              {t('choose_member_first')}
            </Text>
          )}
          {weaponError && <Text fz="xs" c="red">{weaponError}</Text>}
        </Stack>

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
          setWeaponUid(uid);
        }}
        availableOnly
        pinned={{
          preferredUid: selectedUser?.preferredWeaponUid,
          lastUid: pinEval.data?.lastWeaponUid,
        }}
      />
    </Card>
  );
}
