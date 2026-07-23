import {
  Stack,
  Group,
  Select,
  Switch,
  Button,
  Table,
  Badge,
  Text,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { listWeapons, listUsers, listOperators, listCheckouts } from './api';
import { fmtDateTime } from './format';
import { userLabel, weaponLabel } from './labels';
import { MemberInfoModal } from './MemberInfoModal';
import { WeaponInfoModal } from './WeaponInfoModal';

export function LogsPage() {
  const { t } = useTranslation();

  const [weaponUid, setWeaponUid] = useState<number | null>(null);
  const [userUid, setUserUid] = useState<number | null>(null);
  const [operatorUid, setOperatorUid] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [infoMember, setInfoMember] = useState<number | null>(null);
  const [infoWeapon, setInfoWeapon] = useState<number | null>(null);

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

  // Filters span retired entities too, so render the raw tag (not the active-aware
  // helper) — an inactive row must keep its id, not collapse to "[disabled]".
  const weaponData = (weapons.data ?? []).map((w) => ({
    value: String(w.uid),
    label: [
      [w.brand, w.model].filter(Boolean).join(' '),
      w.displayId ? `[${w.displayId}]` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }));
  const userData = (users.data ?? []).map((u) => ({
    value: String(u.uid),
    label: u.name,
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
      <Table.Td style={{ cursor: 'pointer' }} onClick={() => setInfoWeapon(c.weaponUid)}>
        {/* Tag number leads as a chip; the label itself drops the [x] suffix.
            Inactive rows keep the [disabled] marker instead of a chip. */}
        <Group gap="xs" wrap="nowrap">
          {c.weaponActive && c.weaponDisplayId && (
            <Badge color="teal" variant="light" size="lg" radius="sm" style={{ flexShrink: 0 }}>
              {c.weaponDisplayId}
            </Badge>
          )}
          {weaponLabel(c.weaponBrand, c.weaponModel, c.weaponCaliber, null, c.weaponActive, t)}
        </Group>
      </Table.Td>
      <Table.Td style={{ cursor: 'pointer' }} onClick={() => setInfoMember(c.userUid)}>
        {userLabel(c.userName, c.userActive, t, c.userIsGuest)}
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
    </Table.Tr>
  ));

  return (
    // Fill the shell (100vh − 64 header − 48 footer − 2×16 main padding) so the
    // table grows into the free space instead of leaving a void under it.
    <Stack style={{ height: 'calc(100vh - 144px)' }}>
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
        <DateInput
          label={t('label_from')}
          valueFormat="YYYY-MM-DD"
          value={from || null}
          onChange={(v) => setFrom(v ?? '')}
          clearable
          w={150}
        />
        <DateInput
          label={t('label_to')}
          valueFormat="YYYY-MM-DD"
          value={to || null}
          onChange={(v) => setTo(v ?? '')}
          clearable
          w={150}
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
        <Table.ScrollContainer minWidth={900} style={{ flex: 1, minHeight: 0 }}>
          <Table striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('label_checked_out_at')}</Table.Th>
                <Table.Th>{t('field_weapon')}</Table.Th>
                <Table.Th>{t('field_member')}</Table.Th>
                <Table.Th>{t('operator_out')}</Table.Th>
                <Table.Th>{t('label_checked_in_at')}</Table.Th>
                <Table.Th>{t('operator_in')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

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
    </Stack>
  );
}
