import { Stack, Group, Title, Button, Table, Badge, Text, Loader, SimpleGrid } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { type ReactNode } from 'react';
import { getUser, listCheckouts, listWeapons } from './api';
import { userLabel, weaponLabel } from './labels';
import { fmtDateTime } from './format';

// Read-only member view: all member fields + that member's shooting history
// (dates + which weapons). Reached by clicking a row in the members list.
export function MemberDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { uid } = useParams();
  const n = Number(uid);
  const valid = uid !== undefined && !Number.isNaN(n);

  const userQ = useQuery({ queryKey: ['user', n], queryFn: () => getUser(n), enabled: valid });
  const historyQ = useQuery({
    queryKey: ['checkouts', { userUid: n }],
    queryFn: () => listCheckouts({ userUid: n }),
    enabled: valid,
  });
  const weaponsQ = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });

  const back = (
    <Button variant="default" onClick={() => navigate('/members')}>
      {t('back')}
    </Button>
  );

  // Bad/unknown uid, or member not found.
  if (!valid || (userQ.isSuccess && !userQ.data)) {
    return (
      <Stack>
        {back}
        <Text c="dimmed">{t('err_user_not_found', { uid })}</Text>
      </Stack>
    );
  }
  if (userQ.isLoading || !userQ.data) {
    return (
      <Stack>
        {back}
        <Loader />
      </Stack>
    );
  }
  const u = userQ.data;
  const prefWeapon = (weaponsQ.data ?? []).find((w) => w.uid === u.preferredWeaponUid);

  const info: [string, ReactNode][] = [
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
  ];

  const history = historyQ.data ?? [];
  const rows = history.map((c) => (
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
      <Table.Td>{c.checkedInAt ? fmtDateTime(c.checkedInAt) : t('status_out')}</Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{userLabel(u.name, u.displayId, u.active, t)}</Title>
        {back}
      </Group>

      <Title order={4}>{t('member_info')}</Title>
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

      <Title order={4}>{t('shooting_history')}</Title>
      {history.length === 0 ? (
        <Text c="dimmed">{t('no_shooting_history')}</Text>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('label_checked_out_at')}</Table.Th>
                <Table.Th>{t('field_weapon')}</Table.Th>
                <Table.Th>{t('label_checked_in_at')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
