import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, Card, Group, Modal, ScrollArea, Select, Stack, Table, Text, Title, ActionIcon,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import {
  maintenanceStaleAssignments, maintenanceNeverBorrowed, maintenanceTaggedWeapons,
  maintenanceGuests, setPreferredWeapon, promoteGuest,
  type StaleAssignment, type GuestRow,
} from './api';
import { useExportCsv } from './useExportCsv';
import { useIsAdmin } from './useIsAdmin';
import { TagModal } from './TagModal';
import { weaponLabel } from './labels';
import { fmtDate } from './format';
import { errorMessage } from './errors';

export function MaintenancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const doExport = useExportCsv();
  const [months, setMonths] = useState(3);
  const [unassignTarget, setUnassignTarget] = useState<StaleAssignment | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<GuestRow | null>(null);
  const [tagWeapon, setTagWeapon] = useState<number | null>(null);

  const stale = useQuery({
    queryKey: ['maintStale', months],
    queryFn: () => maintenanceStaleAssignments(months),
  });
  const never = useQuery({ queryKey: ['maintNever'], queryFn: maintenanceNeverBorrowed });
  const tagged = useQuery({ queryKey: ['maintTagged'], queryFn: maintenanceTaggedWeapons });
  const guests = useQuery({ queryKey: ['maintGuests'], queryFn: maintenanceGuests });

  const unassignMut = useMutation({
    mutationFn: (userUid: number) => setPreferredWeapon(userUid, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintStale'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setUnassignTarget(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const promoteMut = useMutation({
    mutationFn: (uid: number) => promoteGuest(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintGuests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setPromoteTarget(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const stamp = dayjs().format('YYYY-MM-DD');

  return (
    <ScrollArea h="calc(100vh - 144px)">
      <Stack gap="lg" pb="lg">
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('maint_stale')}</Title>
            <Group>
              <Select
                w={100}
                label={t('maint_months')}
                value={String(months)}
                onChange={(v) => setMonths(v ? Number(v) : 3)}
                data={Array.from({ length: 12 }, (_, i) => String(i + 1))}
              />
              <ActionIcon
                variant="light"
                aria-label={t('export_csv')}
                onClick={() =>
                  doExport('stale_assignments', `ej-anvanda-tilldelade-${stamp}.csv`, { months })
                }
              >
                <IconDownload size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <Table>
            <Table.Tbody>
              {(stale.data ?? []).map((s) => (
                <Table.Tr key={s.userUid}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td>
                    {weaponLabel(s.brand, s.model, s.caliber, s.displayId, s.weaponActive, t)}
                  </Table.Td>
                  <Table.Td c="dimmed">
                    {t('maint_last_used')}:{' '}
                    {s.lastUsed ? fmtDate(s.lastUsed) : t('maint_never_used')}
                  </Table.Td>
                  <Table.Td w={200}>
                    <Button
                      size="sm"
                      color="orange"
                      variant="light"
                      onClick={() => setUnassignTarget(s)}
                    >
                      {t('maint_unassign')}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">{t('maint_never_borrowed')}</Title>
          <Table>
            <Table.Tbody>
              {(never.data ?? []).map((w) => (
                <Table.Tr key={w.weaponUid}>
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t)}
                  </Table.Td>
                  <Table.Td c="dimmed" w={240}>
                    {t('maint_registered')}: {fmtDate(w.createdAt)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">{t('maint_tagged')}</Title>
          <Table highlightOnHover>
            <Table.Tbody>
              {(tagged.data ?? []).map((w) => (
                <Table.Tr
                  key={w.weaponUid}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setTagWeapon(w.weaponUid)}
                >
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, true, t)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {w.tagNeedsService && <Badge color="yellow">{t('tag_needs_service')}</Badge>}
                      {w.tagBroken && <Badge color="red">{t('tag_broken')}</Badge>}
                      {w.tagMissingParts && <Badge color="orange">{t('tag_missing_parts')}</Badge>}
                      {w.tagNeedsCleaning && <Badge color="blue">{t('tag_needs_cleaning')}</Badge>}
                      {w.tagComment && <Text size="sm" c="dimmed">{w.tagComment}</Text>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_guests')}</Title>
            <ActionIcon
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('guests', `gaster-${stamp}.csv`)}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(guests.data ?? []).map((g) => (
                <Table.Tr key={g.userUid}>
                  <Table.Td>{g.name}</Table.Td>
                  <Table.Td w={140}>{t('stats_count_loans')}: {g.loanCount}</Table.Td>
                  <Table.Td c="dimmed" w={240}>
                    {t('maint_last_visit')}: {g.lastVisit ? fmtDate(g.lastVisit) : '–'}
                  </Table.Td>
                  <Table.Td w={180}>
                    {isAdmin && (
                      <Button size="sm" variant="light" onClick={() => setPromoteTarget(g)}>
                        {t('promote_guest')}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>

      <Modal
        opened={unassignTarget != null}
        onClose={() => setUnassignTarget(null)}
        title={t('maint_unassign')}
        centered
      >
        <Stack>
          <Text fz="lg">
            {unassignTarget &&
              t('maint_unassign_confirm', {
                weapon: weaponLabel(
                  unassignTarget.brand, unassignTarget.model, unassignTarget.caliber,
                  unassignTarget.displayId, unassignTarget.weaponActive, t,
                ),
                name: unassignTarget.name,
              })}
          </Text>
          <Text fz="lg" fw={600}>{t('are_you_sure')}</Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setUnassignTarget(null)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              color="orange"
              loading={unassignMut.isPending}
              onClick={() => unassignTarget && unassignMut.mutate(unassignTarget.userUid)}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={promoteTarget != null}
        onClose={() => setPromoteTarget(null)}
        title={t('promote_guest')}
        centered
      >
        <Stack>
          <Text fz="lg">
            {promoteTarget && t('promote_confirm', { name: promoteTarget.name })}
          </Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setPromoteTarget(null)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              loading={promoteMut.isPending}
              onClick={() => promoteTarget && promoteMut.mutate(promoteTarget.userUid)}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <TagModal
        weaponUid={tagWeapon}
        opened={tagWeapon != null}
        onClose={() => {
          setTagWeapon(null);
          qc.invalidateQueries({ queryKey: ['maintTagged'] });
        }}
      />
    </ScrollArea>
  );
}
