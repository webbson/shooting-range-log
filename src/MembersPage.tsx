import {
  Group,
  Title,
  Button,
  Table,
  Badge,
  Modal,
  TextInput,
  Textarea,
  Switch,
  Stack,
  Text,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  listUsers,
  createUser,
  updateUser,
  setUserActive,
  outstandingDebts,
  type User,
} from './api';
import { errorMessage } from './errors';
import { DebtModal } from './DebtModal';

interface MemberForm {
  displayId: string;
  memberNumber: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  ssn: string;
  isStaff: boolean;
  notes: string;
}

const EMPTY: MemberForm = {
  displayId: '',
  memberNumber: '',
  name: '',
  email: '',
  phone: '',
  address: '',
  ssn: '',
  isStaff: false,
  notes: '',
};

export function MembersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [debtUser, setDebtUser] = useState<User | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));

  const form = useForm<MemberForm>({
    initialValues: EMPTY,
    validate: { name: (v) => (v.trim() ? null : t('name_required')) },
  });

  const save = useMutation({
    mutationFn: (v: MemberForm) =>
      editing ? updateUser({ ...v, uid: editing.uid }) : createUser(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['operators'] });
      close();
      notifications.show({ message: t('saved') });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const toggleActive = useMutation({
    mutationFn: (u: User) => setUserActive(u.uid, !u.active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['operators'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const openCreate = () => {
    setEditing(null);
    form.setValues(EMPTY);
    form.resetDirty(EMPTY);
    open();
  };

  const openEdit = (u: User) => {
    setEditing(u);
    form.setValues({
      displayId: u.displayId ?? '',
      memberNumber: u.memberNumber ?? '',
      name: u.name,
      email: u.email ?? '',
      phone: u.phone ?? '',
      address: u.address ?? '',
      ssn: u.ssn ?? '',
      isStaff: u.isStaff,
      notes: u.notes ?? '',
    });
    open();
  };

  const rows = (users.data ?? []).map((u) => (
    <Table.Tr key={u.uid} opacity={u.active ? 1 : 0.5}>
      <Table.Td>{u.displayId}</Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {u.name}
          {debtMap.has(u.uid) && (
            <Badge color="red" variant="filled">
              {t('debt_badge', { amount: debtMap.get(u.uid) })}
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>{u.memberNumber}</Table.Td>
      <Table.Td>{u.phone}</Table.Td>
      <Table.Td>{u.isStaff && <Badge color="grape">{t('staff')}</Badge>}</Table.Td>
      <Table.Td>
        <Badge color={u.active ? 'teal' : 'gray'} variant="light">
          {u.active ? t('active') : t('inactive')}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Button size="xs" variant="subtle" color="red" onClick={() => setDebtUser(u)}>
            {t('debt')}
          </Button>
          <Button size="xs" variant="default" onClick={() => openEdit(u)}>
            {t('edit')}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color={u.active ? 'red' : 'teal'}
            onClick={() => toggleActive.mutate(u)}
          >
            {u.active ? t('deactivate') : t('activate')}
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav_members')}</Title>
        <Button onClick={openCreate}>{t('new_member')}</Button>
      </Group>

      {(users.data?.length ?? 0) === 0 ? (
        <Text c="dimmed">{t('no_members')}</Text>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('field_display_id')}</Table.Th>
                <Table.Th>{t('field_name')}</Table.Th>
                <Table.Th>{t('field_member_number')}</Table.Th>
                <Table.Th>{t('field_phone')}</Table.Th>
                <Table.Th />
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={opened}
        onClose={close}
        title={editing ? t('edit_member') : t('new_member')}
        centered
      >
        <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
          <Stack>
            <Group grow>
              <TextInput
                label={t('field_display_id')}
                {...form.getInputProps('displayId')}
              />
              <TextInput
                label={t('field_member_number')}
                {...form.getInputProps('memberNumber')}
              />
            </Group>
            <TextInput
              label={t('field_name')}
              withAsterisk
              {...form.getInputProps('name')}
            />
            <Group grow>
              <TextInput label={t('field_email')} {...form.getInputProps('email')} />
              <TextInput label={t('field_phone')} {...form.getInputProps('phone')} />
            </Group>
            <TextInput label={t('field_address')} {...form.getInputProps('address')} />
            <TextInput label={t('field_ssn')} {...form.getInputProps('ssn')} />
            <Switch
              label={t('field_is_staff')}
              {...form.getInputProps('isStaff', { type: 'checkbox' })}
            />
            <Textarea
              label={t('field_notes')}
              autosize
              minRows={2}
              {...form.getInputProps('notes')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                {t('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <DebtModal
        userUid={debtUser?.uid ?? null}
        userName={debtUser?.name ?? ''}
        opened={debtUser != null}
        onClose={() => setDebtUser(null)}
      />
    </Stack>
  );
}
