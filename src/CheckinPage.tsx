import {
  Card,
  Stack,
  Group,
  Title,
  Text,
  Button,
  ActionIcon,
  Tooltip,
  ScrollArea,
} from '@mantine/core';
import { IconCoins, IconArrowBackUp, IconTag } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  listUsers,
  listOpenCheckouts,
  doCheckin,
  setPreferredWeapon,
  outstandingDebts,
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';
import { DebtModal } from './DebtModal';
import { IdNumpadModal } from './IdNumpadModal';
import { MemberInfoModal } from './MemberInfoModal';
import { WeaponInfoModal } from './WeaponInfoModal';
import { TagModal } from './TagModal';

export function CheckinPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [debtUser, setDebtUser] = useState<{ uid: number; name: string } | null>(null);
  const [infoMember, setInfoMember] = useState<number | null>(null);
  const [infoWeapon, setInfoWeapon] = useState<number | null>(null);
  const [fastCheckinOpen, setFastCheckinOpen] = useState(false);
  const [tagWeapon, setTagWeapon] = useState<number | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    // Self-heal: intermittent stale list after a return was seen at live-smoke
    // but never reproduced under investigation (see BACKLOG). Periodic refetch
    // bounds any staleness at 30s; a local SELECT every 30s is free.
    refetchInterval: 30_000,
  });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const debtMap = new Map((debts.data ?? []).map((d) => [d.userUid, d.amountKr] as const));

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const checkinMut = useMutation({
    mutationFn: (id: number) => doCheckin(id, operator!.uid),
    onSuccess: () => {
      notifications.show({ message: t('returned_ok') });
      qc.invalidateQueries({ queryKey: ['openCheckouts'] });
      qc.invalidateQueries({ queryKey: ['eval'] });
      qc.invalidateQueries({ queryKey: ['lastWeaponUsers'] });
      qc.invalidateQueries({ queryKey: ['lastShotDates'] });
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

  const matchCheckin = (id: string): React.ReactNode | null => {
    const o = (open.data ?? []).find((x) => x.weaponDisplayId === id);
    if (!o) return null;
    return (
      <Stack gap={2}>
        <Text fw={600} c="teal">
          {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, o.weaponDisplayId, o.weaponActive, t)}
        </Text>
        <Text size="sm">
          {userLabel(o.userName, o.userDisplayId, o.userActive, t, o.userIsGuest)}
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
          // List scrolls inside the card; title + fast check-in stay put.
          // ponytail: 240px ≈ shell header + card chrome — tune at live-smoke if clipped.
          <ScrollArea.Autosize mah="calc(100vh - 240px)" type="auto">
            <Stack gap="sm">
              {(open.data ?? []).map((o) => (
                <Card key={o.id} withBorder padding="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text
                        fw={600}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setInfoWeapon(o.weaponUid)}
                      >
                        {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, o.weaponDisplayId, o.weaponActive, t)}
                      </Text>
                      <Text
                        size="sm"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setInfoMember(o.userUid)}
                      >
                        {userLabel(o.userName, o.userDisplayId, o.userActive, t, o.userIsGuest)}
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
                      <Tooltip label={t('edit_tags')}>
                        <ActionIcon
                          variant="subtle"
                          color="orange"
                          size="lg"
                          aria-label={t('edit_tags')}
                          onClick={() => setTagWeapon(o.weaponUid)}
                        >
                          <IconTag />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('add_debt')}>
                        <ActionIcon
                          variant={debtMap.has(o.userUid) ? 'filled' : 'subtle'}
                          color="red"
                          size="lg"
                          aria-label={t('add_debt')}
                          onClick={() =>
                            setDebtUser({
                              uid: o.userUid,
                              name: userLabel(o.userName, o.userDisplayId, o.userActive, t, o.userIsGuest),
                            })
                          }
                        >
                          <IconCoins />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('return_weapon')}>
                        <ActionIcon
                          variant="light"
                          color="teal"
                          size="lg"
                          aria-label={t('return_weapon')}
                          loading={checkinMut.isPending}
                          onClick={() => checkinMut.mutate(o.id)}
                        >
                          <IconArrowBackUp />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Card>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>

      <DebtModal
        userUid={debtUser?.uid ?? null}
        userName={debtUser?.name ?? ''}
        opened={debtUser != null}
        onClose={() => setDebtUser(null)}
      />

      <MemberInfoModal
        uid={infoMember}
        opened={infoMember != null}
        onClose={() => setInfoMember(null)}
      />
      <WeaponInfoModal
        uid={infoWeapon}
        opened={infoWeapon != null}
        onClose={() => setInfoWeapon(null)}
      />
      <TagModal weaponUid={tagWeapon} opened={tagWeapon != null} onClose={() => setTagWeapon(null)} />

      <IdNumpadModal
        opened={fastCheckinOpen}
        title={t('fast_checkin')}
        match={matchCheckin}
        confirmLabel={t('return_weapon')}
        placeholder={t('enter_weapon_id')}
        onClose={() => setFastCheckinOpen(false)}
        onSubmit={onFastCheckinSubmit}
      />
    </Card>
  );
}
