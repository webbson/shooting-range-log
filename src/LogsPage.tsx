import {
  Stack,
  Group,
  Title,
  Select,
  TextInput,
  Switch,
  Button,
  Table,
  Badge,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { listWeapons, listUsers, listOperators, listCheckouts } from './api';
import { fmtDateTime } from './format';

export function LogsPage() {
  const { t } = useTranslation();

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [operatorUid, setOperatorUid] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const operators = useQuery({ queryKey: ['operators'], queryFn: listOperators });

  const logs = useQuery({
    queryKey: ['logs', weaponUid, userUid, operatorUid, from, to, onlyOpen],
    queryFn: () =>
      listCheckouts({
        weaponUid,
        userUid,
        operatorUid,
        from: from || null,
        to: to || null,
        onlyOpen,
      }),
  });

  const weaponData = (weapons.data ?? []).map((w) => ({
    value: String(w.uid),
    label: [w.displayId, [w.brand, w.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
  }));
  const userData = (users.data ?? []).map((u) => ({
    value: String(u.uid),
    label: [u.displayId, u.name].filter(Boolean).join(' · '),
  }));
  const operatorData = (operators.data ?? []).map((o) => ({
    value: String(o.uid),
    label: o.name,
  }));

  const clearFilters = () => {
    setWeaponUid(null);
    setUserUid(null);
    setOperatorUid(null);
    setFrom('');
    setTo('');
    setOnlyOpen(false);
  };

  const rows = (logs.data ?? []).map((c) => (
    <Table.Tr key={c.id}>
      <Table.Td>{fmtDateTime(c.checkedOutAt)}</Table.Td>
      <Table.Td>
        {c.weaponDisplay} {c.weaponLabel && `· ${c.weaponLabel}`}
      </Table.Td>
      <Table.Td>
        {c.userDisplay && `${c.userDisplay} · `}
        {c.userName}
      </Table.Td>
      <Table.Td>{c.operatorOutName}</Table.Td>
      <Table.Td>
        {c.checkedInAt ? (
          fmtDateTime(c.checkedInAt)
        ) : (
          <Badge color="orange" variant="light">
            {t('status_out')}
          </Badge>
        )}
      </Table.Td>
      <Table.Td>{c.operatorInName}</Table.Td>
      <Table.Td>{c.notes}</Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack>
      <Title order={2}>{t('nav_logs')}</Title>

      <Group align="flex-end" wrap="wrap">
        <Select
          label={t('field_weapon')}
          data={weaponData}
          value={weaponUid != null ? String(weaponUid) : null}
          onChange={(v) => setWeaponUid(v ? Number(v) : null)}
          searchable
          clearable
          w={220}
        />
        <Select
          label={t('field_member')}
          data={userData}
          value={userUid != null ? String(userUid) : null}
          onChange={(v) => setUserUid(v ? Number(v) : null)}
          searchable
          clearable
          w={220}
        />
        <Select
          label={t('operator')}
          data={operatorData}
          value={operatorUid != null ? String(operatorUid) : null}
          onChange={(v) => setOperatorUid(v ? Number(v) : null)}
          searchable
          clearable
          w={180}
        />
        <TextInput
          label={t('label_from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <TextInput
          label={t('label_to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
        <Switch
          label={t('only_open')}
          checked={onlyOpen}
          onChange={(e) => setOnlyOpen(e.currentTarget.checked)}
        />
        <Button variant="default" onClick={clearFilters}>
          {t('clear_filters')}
        </Button>
      </Group>

      {(logs.data?.length ?? 0) === 0 ? (
        <Text c="dimmed">{t('no_results')}</Text>
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('label_checked_out_at')}</Table.Th>
                <Table.Th>{t('field_weapon')}</Table.Th>
                <Table.Th>{t('field_member')}</Table.Th>
                <Table.Th>{t('operator_out')}</Table.Th>
                <Table.Th>{t('label_checked_in_at')}</Table.Th>
                <Table.Th>{t('operator_in')}</Table.Th>
                <Table.Th>{t('field_checkout_notes')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
