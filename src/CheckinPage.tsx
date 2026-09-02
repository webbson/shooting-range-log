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
  Badge,
} from '@mantine/core';
import { IconCoins, IconArrowBackUp, IconTag } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  listUsers,
  listWeapons,
  listOpenCheckouts,
  doCheckin,
  setPreferredWeapon,
  outstandingDebts,
  type OpenCheckout,
} from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';
import { useScan } from './useScanner';
import { findWeaponByCandidates, findUserBySsn } from './scanMatch';
import { DebtModal } from './DebtModal';
import { IdNumpadModal } from './IdNumpadModal';
import { MemberInfoModal } from './MemberInfoModal';
import { WeaponInfoModal } from './WeaponInfoModal';
import { TagModal } from './TagModal';
import { CheckinConfirmModal, CheckinLoanPreview } from './CheckinConfirmModal';

export function CheckinPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const [debtUser, setDebtUser] = useState<{ uid: number; name: string } | null>(null);
  const [infoMember, setInfoMember] = useState<number | null>(null);
  const [infoWeapon, setInfoWeapon] = useState<number | null>(null);
  const [fastCheckinOpen, setFastCheckinOpen] = useState(false);
  const [tagWeapon, setTagWeapon] = useState<number | null>(null);
  const [scanLoan, setScanLoan] = useState<OpenCheckout | null>(null);
  const [scanUserFilter, setScanUserFilter] = useState<{ uid: number; name: string } | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
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
    return <CheckinLoanPreview loan={o} />;
  };

  const onFastCheckinSubmit = (id: string) => {
    const o = (open.data ?? []).find((x) => x.weaponDisplayId === id);
    if (o) {
      checkinMut.mutate(o.id);
      setFastCheckinOpen(false);
    }
  };

  // Scan-driven check-in never mutates directly (unlike onFastCheckinSubmit,
  // whose numpad Enter IS the confirmation) — every scan resolves to a loan
  // and opens CheckinConfirmModal, or a notification if it can't.
  useScan((scan) => {
    if (scan.kind === 'weapon') {
      const w = findWeaponByCandidates(weapons.data ?? [], scan.candidates);
      if (!w) {
        notifications.show({ color: 'red', message: t('scan_weapon_unknown') });
        return;
      }
      const loan = (open.data ?? []).find((o) => o.weaponUid === w.uid);
      if (!loan) {
        notifications.show({ color: 'red', message: t('scan_weapon_not_out') });
        return;
      }
      setScanLoan(loan);
      return;
    }
    if (scan.kind !== 'ssn') return; // 'unknown' never reaches useScan handlers

    const u = findUserBySsn(users.data ?? [], scan.ssn);
    if (!u) {
      notifications.show({ color: 'red', message: t('scan_member_not_found') });
      return;
    }
    const loans = (open.data ?? []).filter((o) => o.userUid === u.uid);
    const name = userLabel(u.name, u.active, t, u.isGuest);
    if (loans.length === 0) {
      notifications.show({ color: 'red', message: t('scan_no_open_loans', { name }) });
      return;
    }
    if (loans.length === 1) {
      setScanUserFilter(null);
      setScanLoan(loans[0]);
      return;
    }
    setScanUserFilter({ uid: u.uid, name });
  });

  const visibleOpen = scanUserFilter
    ? (open.data ?? []).filter((o) => o.userUid === scanUserFilter.uid)
    : (open.data ?? []);

  return (
    <>
      {/* Fill the shell (100vh − 64 header − 48 footer − 2×16 main padding) so the
          list grows into the free space instead of leaving a void under it. */}
      <Stack gap="lg" style={{ height: 'calc(100vh - 144px)' }}>
        <Group justify="space-between" align="center">
          <Title order={3}>{t('open_checkouts')}</Title>
          <Button size="lg" variant="default" onClick={() => setFastCheckinOpen(true)}>
            {t('fast_checkin')}
          </Button>
        </Group>
        {scanUserFilter && (
          // SSN scan matched several open loans — filter the list to them
          // rather than picking; the badge names the active filter, the
          // button is the one-tap way to clear it.
          <Group>
            <Badge size="lg" variant="light" color="teal">
              {scanUserFilter.name}
            </Badge>
            <Button size="lg" variant="subtle" onClick={() => setScanUserFilter(null)}>
              {t('clear_filters')}
            </Button>
          </Group>
        )}
        {visibleOpen.length === 0 ? (
          <Text c="dimmed">{t('no_open_checkouts')}</Text>
        ) : (
          // List scrolls in the remaining space; title + fast check-in stay put.
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
            {/* Responsive columns: as many 480px-min cards as the width fits. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
                gap: 'var(--mantine-spacing-sm)',
              }}
            >
              {visibleOpen.map((o) => (
                <Card key={o.id} withBorder padding={0}>
                  <Group wrap="nowrap" gap={0} align="stretch">
                    {/* Full-height tag stripe — the number the operator reads
                        off the physical weapon, so it leads the card. */}
                    <Stack
                      justify="center"
                      align="center"
                      miw={72}
                      px="sm"
                      style={{
                        background: 'var(--mantine-color-teal-light)',
                        alignSelf: 'stretch',
                      }}
                    >
                      <Text fz={40} fw={800} c="var(--mantine-color-teal-light-color)">
                        {o.weaponDisplayId ?? '—'}
                      </Text>
                    </Stack>
                    <Group
                      justify="space-between"
                      wrap="nowrap"
                      p="md"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                    <Stack gap={2}>
                      <Text
                        fw={600}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setInfoWeapon(o.weaponUid)}
                      >
                        {weaponLabel(o.weaponBrand, o.weaponModel, o.weaponCaliber, null, o.weaponActive, t)}
                      </Text>
                      <Text
                        size="sm"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setInfoMember(o.userUid)}
                      >
                        {userLabel(o.userName, o.userActive, t, o.userIsGuest)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t('label_checked_out_at')}: {fmtDateTime(o.checkedOutAt)}
                      </Text>
                    </Stack>
                    {/* Two clusters: member actions (assign, debt) apart from
                        weapon actions (tag, return) — return stays rightmost. */}
                    <Group gap="xl" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap">
                        {(() => {
                          const p = preferrerOf(o.weaponUid);
                          if (p && p.uid !== o.userUid) return null; // another member's favorite
                          const mine = p != null;
                          return (
                            <Tooltip label={mine ? t('unmark_favorite') : t('mark_favorite')}>
                              <ActionIcon
                                variant={mine ? 'light' : 'subtle'}
                                color="yellow"
                                size="xl"
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
                        <Tooltip label={t('add_debt')}>
                          <ActionIcon
                            variant={debtMap.has(o.userUid) ? 'filled' : 'subtle'}
                            color="red"
                            size="xl"
                            aria-label={t('add_debt')}
                            onClick={() =>
                              setDebtUser({
                                uid: o.userUid,
                                name: userLabel(o.userName, o.userActive, t, o.userIsGuest),
                              })
                            }
                          >
                            <IconCoins />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                      <Group gap="sm" wrap="nowrap">
                        <Tooltip label={t('edit_tags')}>
                          <ActionIcon
                            variant="subtle"
                            color="orange"
                            size="xl"
                            aria-label={t('edit_tags')}
                            onClick={() => setTagWeapon(o.weaponUid)}
                          >
                            <IconTag />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('return_weapon')}>
                          <ActionIcon
                            variant="light"
                            color="teal"
                            size="xl"
                            aria-label={t('return_weapon')}
                            loading={checkinMut.isPending}
                            onClick={() => checkinMut.mutate(o.id)}
                          >
                            <IconArrowBackUp />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                    </Group>
                  </Group>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </Stack>

      <CheckinConfirmModal
        loan={scanLoan}
        opened={scanLoan != null}
        onClose={() => setScanLoan(null)}
        loading={checkinMut.isPending}
        onConfirm={() => {
          if (scanLoan) checkinMut.mutate(scanLoan.id);
          setScanLoan(null);
        }}
      />

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
    </>
  );
}
