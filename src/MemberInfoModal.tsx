import {
  Modal,
  Stack,
  Title,
  Badge,
  Table,
  Text,
  SimpleGrid,
  ScrollArea,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { getUser, listCheckouts, listWeapons } from './api';
import { userLabel, weaponLabel } from './labels';
import { fmtDateTime } from './format';

// Read-only member view: all member fields + shooting history. Launched from
// the members list, the open-loans list, and log rows.
export function MemberInfoModal({
  uid,
  opened,
  onClose,
}: {
  uid: number | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enabled = opened && uid != null;

  const userQ = useQuery({
    queryKey: ['user', uid],
    queryFn: () => getUser(uid!),
    enabled,
  });
  const historyQ = useQuery({
    queryKey: ['checkouts', { userUid: uid }],
    queryFn: () => listCheckouts({ userUid: uid }),
    enabled,
  });
  const weaponsQ = useQuery({ queryKey: ['weapons'], queryFn: listWeapons, enabled });

  const u = userQ.data;
  const prefWeapon = (weaponsQ.data ?? []).find((w) => w.uid === u?.preferredWeaponUid);

  const info: [string, ReactNode][] = u
    ? [
        [t('field_email'), u.email ?? '—'],
        [t('field_phone'), u.phone ?? '—'],
        [t('field_address'), u.address ?? '—'],
        [t('field_ssn'), u.ssn ?? '—'],
        [
          t('field_preferred_weapon'),
          prefWeapon
            ? weaponLabel(
                prefWeapon.brand,
                prefWeapon.model,
                prefWeapon.caliber,
                prefWeapon.displayId,
                prefWeapon.active,
                t,
              )
            : '—',
        ],
        [
          t('status'),
          <Badge color={u.active ? 'teal' : 'gray'} variant="light">
            {u.active ? t('active') : t('inactive')}
          </Badge>,
        ],
        [t('field_notes'), u.notes ?? '—'],
      ]
    : [];

  const history = historyQ.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={u ? userLabel(u.name, u.active, t, u.isGuest) : ''}
      size="xl"
      centered
    >
      {u && (
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="sm">
            {info.map(([label, value]) => (
              <div key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text component="div">{value}</Text>
              </div>
            ))}
          </SimpleGrid>

          <Title order={5}>{t('shooting_history')}</Title>
          {history.length === 0 ? (
            <Text c="dimmed">{t('no_shooting_history')}</Text>
          ) : (
            <ScrollArea.Autosize mah={320} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('label_checked_out_at')}</Table.Th>
                    <Table.Th>{t('field_weapon')}</Table.Th>
                    <Table.Th>{t('label_checked_in_at')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>{fmtDateTime(c.checkedOutAt)}</Table.Td>
                      <Table.Td>
                        {weaponLabel(
                          c.weaponBrand,
                          c.weaponModel,
                          c.weaponCaliber,
                          c.weaponDisplayId,
                          c.weaponActive,
                          t,
                        )}
                      </Table.Td>
                      <Table.Td>
                        {c.checkedInAt ? fmtDateTime(c.checkedInAt) : t('status_out')}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}
