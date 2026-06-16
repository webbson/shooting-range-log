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
  Checkbox,
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
  nextUserDisplayId,
  outstandingDebts,
  type User,
} from './api';
import { errorMessage } from './errors';
import { userLabel } from './labels';
import { DebtModal } from './DebtModal';

interface MemberForm {
  displayId: string;
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

  // Deactivation flow (optional tag release).
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [clearId, setClearId] = useState(false);

  // List view: active-only by default, with a search box + show-inactive toggle.
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));

  const form = useForm<MemberForm>({
    initialValues: EMPTY,
    validate: { name: (v) => (v.trim() ? null : t('name_required')) },
  });

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['operators'] });
  };

  // An active member (a new one, or an existing active one being edited) must
  // carry an ID. Inactive members may have it cleared. Rust enforces this too.
  const idRequired = !editing || editing.active;

  const save = useMutation({
    mutationFn: (v: MemberForm) =>
      editing ? updateUser({ ...v, uid: editing.uid }) : createUser(v),
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  // Activate an inactive member: persist the (possibly newly entered) ID first,
  // then flip it active.
  const activate = useMutation({
    mutationFn: async (v: MemberForm) => {
      if (!editing) throw new Error('no member');
      await updateUser({ ...v, uid: editing.uid });
      return setUserActive(editing.uid, true);
    },
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  const setActive = useMutation({
    mutationFn: (args: { uid: number; active: boolean; clearDisplayId?: boolean }) =>
      setUserActive(args.uid, args.active, args.clearDisplayId),
    onSuccess: () => {
      invalidate();
      setDeactivating(null);
      setClearId(false);
    },
    onError,
  });

  const suggestId = useMutation({
    mutationFn: nextUserDisplayId,
    onSuccess: (id) => form.setFieldValue('displayId', id),
    onError,
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

  const onSave = (v: MemberForm) => {
    if (idRequired && !v.displayId.trim()) {
      form.setFieldError('displayId', t('display_id_required'));
      return;
    }
    save.mutate(v);
  };

  const onActivate = () => {
    if (form.validate().hasErrors) return;
    if (!form.values.displayId.trim()) {
      form.setFieldError('displayId', t('display_id_required'));
      return;
    }
    activate.mutate(form.values);
  };

  const openDeactivate = (u: User) => {
    setClearId(false);
    setDeactivating(u);
    close();
  };

  const q = search.trim().toLowerCase();
  const filtered = (users.data ?? []).filter((u) => {
    if (!showInactive && !u.active) return false;
    if (!q) return true;
    return [u.displayId, u.name, u.email, u.phone].some((f) =>
      f?.toLowerCase().includes(q),
    );
  });

  const rows = filtered.map((u) => (
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
        <>
          <Group>
            <TextInput
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Switch
              label={t('show_inactive')}
              checked={showInactive}
              onChange={(e) => setShowInactive(e.currentTarget.checked)}
            />
          </Group>
          {filtered.length === 0 ? (
            <Text c="dimmed">{t('no_results')}</Text>
          ) : (
            <Table.ScrollContainer minWidth={700}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('field_display_id')}</Table.Th>
                    <Table.Th>{t('field_name')}</Table.Th>
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
        </>
      )}

      {/* Create / edit */}
      <Modal
        opened={opened}
        onClose={close}
        title={editing ? t('edit_member') : t('new_member')}
        centered
      >
        <form onSubmit={form.onSubmit(onSave)}>
          <Stack>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                label={t('field_display_id')}
                withAsterisk={idRequired}
                {...form.getInputProps('displayId')}
              />
              {!form.values.displayId.trim() && (
                <Button
                  variant="default"
                  loading={suggestId.isPending}
                  onClick={() => suggestId.mutate()}
                >
                  {t('next_free_id')}
                </Button>
              )}
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
            <Group justify="space-between">
              {editing && !editing.active ? (
                <Button
                  variant="subtle"
                  color="teal"
                  loading={activate.isPending}
                  onClick={onActivate}
                >
                  {t('activate')}
                </Button>
              ) : editing ? (
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => openDeactivate(editing)}
                >
                  {t('deactivate')}
                </Button>
              ) : (
                <span />
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={close}>
                  {t('cancel')}
                </Button>
                <Button type="submit" loading={save.isPending}>
                  {t('save')}
                </Button>
              </Group>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Deactivate + optional tag release */}
      <Modal
        opened={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={t('confirm_deactivate_title')}
        centered
      >
        <Stack>
          <Checkbox
            label={t('clear_display_id_member')}
            checked={clearId}
            onChange={(e) => setClearId(e.currentTarget.checked)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeactivating(null)}>
              {t('cancel')}
            </Button>
            <Button
              color="red"
              loading={setActive.isPending}
              onClick={() =>
                deactivating &&
                setActive.mutate({
                  uid: deactivating.uid,
                  active: false,
                  clearDisplayId: clearId,
                })
              }
            >
              {t('deactivate')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <DebtModal
        userUid={debtUser?.uid ?? null}
        userName={
          debtUser ? userLabel(debtUser.name, debtUser.displayId, debtUser.active, t) : ''
        }
        opened={debtUser != null}
        onClose={() => setDebtUser(null)}
      />
    </Stack>
  );
}
