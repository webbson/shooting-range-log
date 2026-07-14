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
import { getWeapon, listCheckouts, listWeaponService } from './api';
import { userLabel, weaponLabel } from './labels';
import { fmtDateTime } from './format';

// Read-only weapon view: fields + usage history + service log. Launched from
// the open-loans list and log rows.
export function WeaponInfoModal({
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

  const weaponQ = useQuery({
    queryKey: ['weapon', uid],
    queryFn: () => getWeapon(uid!),
    enabled,
  });
  const historyQ = useQuery({
    queryKey: ['checkouts', { weaponUid: uid }],
    queryFn: () => listCheckouts({ weaponUid: uid }),
    enabled,
  });
  const serviceQ = useQuery({
    queryKey: ['service', uid],
    queryFn: () => listWeaponService(uid!),
    enabled,
  });

  const w = weaponQ.data;

  const info: [string, ReactNode][] = w
    ? [
        [t('field_display_id'), w.displayId ?? '—'],
        [t('field_brand'), w.brand ?? '—'],
        [t('field_model'), w.model ?? '—'],
        [t('field_caliber'), w.caliber ?? '—'],
        [t('field_serial'), w.serial ?? '—'],
        [
          t('status'),
          <>
            <Badge color={w.active ? 'teal' : 'gray'} variant="light">
              {w.active ? t('active') : t('inactive')}
            </Badge>
            {!w.active && w.inactiveReason && (
              <Text size="xs" c="dimmed">
                {w.inactiveReason}
              </Text>
            )}
          </>,
        ],
        [t('field_notes'), w.notes ?? '—'],
      ]
    : [];

  const history = historyQ.data ?? [];
  const service = serviceQ.data ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        w ? weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t) : ''
      }
      size="xl"
      centered
    >
      {w && (
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

          <Title order={5}>{t('usage_history')}</Title>
          {history.length === 0 ? (
            <Text c="dimmed">{t('no_shooting_history')}</Text>
          ) : (
            <ScrollArea.Autosize mah={240} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('label_checked_out_at')}</Table.Th>
                    <Table.Th>{t('field_member')}</Table.Th>
                    <Table.Th>{t('label_checked_in_at')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>{fmtDateTime(c.checkedOutAt)}</Table.Td>
                      <Table.Td>
                        {userLabel(c.userName, c.userDisplayId, c.userActive, t)}
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

          <Title order={5}>{t('service')}</Title>
          {service.length === 0 ? (
            <Text c="dimmed">{t('no_service')}</Text>
          ) : (
            <ScrollArea.Autosize mah={240} type="auto">
              <Table striped stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('field_serviced_at')}</Table.Th>
                    <Table.Th>{t('field_description')}</Table.Th>
                    <Table.Th>{t('operator')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {service.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td>{fmtDateTime(s.servicedAt)}</Table.Td>
                      <Table.Td>{s.description}</Table.Td>
                      <Table.Td>{s.operatorName}</Table.Td>
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
