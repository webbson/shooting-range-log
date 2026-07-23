import {
  Group,
  Grid,
  Button,
  Table,
  Badge,
  Modal,
  TextInput,
  Textarea,
  Switch,
  Select,
  Checkbox,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  Input,
  CloseButton,
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
  setPreferredWeapon,
  outstandingDebts,
  lastShotDates,
  listWeapons,
  promoteGuest,
  type User,
} from './api';
import { errorMessage } from './errors';
import { userLabel, weaponLabel } from './labels';
import { WeaponPickerModal } from './WeaponPickerModal';
import { fmtDate } from './format';
import { DebtModal } from './DebtModal';
import { MemberInfoModal } from './MemberInfoModal';
import { useIsAdmin } from './useIsAdmin';

const SSN_RE = /^\d{8}-\d{4}$/;
const isValidSwedishSSN = (s: string) => SSN_RE.test(s.trim());

type SortKey = 'name' | 'lastShot' | 'assignedWeapon';

interface MemberForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  ssn: string;
  isStaff: boolean;
  isAdmin: boolean;
  notes: string;
}

const EMPTY: MemberForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  ssn: '',
  isStaff: false,
  isAdmin: false,
  notes: '',
};

export function MembersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [debtUser, setDebtUser] = useState<User | null>(null);
  const [infoUid, setInfoUid] = useState<number | null>(null);

  // Preferred weapon: separate from the form — saved via set_preferred_weapon.
  const [prefUid, setPrefUid] = useState<number | null>(null);
  const [prefPickerOpen, setPrefPickerOpen] = useState(false);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const prefWeapon = (weapons.data ?? []).find((w) => w.uid === prefUid);

  // Deactivation flow.
  const [deactivating, setDeactivating] = useState<User | null>(null);

  // List view: active-only by default, with a search box + show-inactive toggle.
  const [search, setSearch] = useState('');
  // One exclusive list view: active members (default) / inactive / guests (admin).
  const [view, setView] = useState<'active' | 'inactive' | 'guests'>('active');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });
  const toggleSort = (k: SortKey) =>
    setSort((s) =>
      s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' },
    );

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const debtMap = new Map((debts.data ?? []).map((o) => [o.userUid, o.amountKr] as const));
  const shots = useQuery({ queryKey: ['lastShotDates'], queryFn: lastShotDates });
  const lastShotMap = new Map((shots.data ?? []).map((s) => [s.userUid, s.lastShotAt] as const));
  const weaponMap = new Map((weapons.data ?? []).map((w) => [w.uid, w] as const));
  const assignedLabel = (u: User): string | undefined => {
    const w = u.preferredWeaponUid != null ? weaponMap.get(u.preferredWeaponUid) : undefined;
    return w ? weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t) : undefined;
  };

  const form = useForm<MemberForm>({
    initialValues: EMPTY,
    validate: {
      name: (v) => (v.trim() ? null : t('name_required')),
      ssn: (v) => {
        if (!v.trim()) return t('ssn_required');
        if (!isValidSwedishSSN(v)) return t('ssn_format_invalid');
        return null;
      },
    },
  });

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['operators'] });
    qc.invalidateQueries({ queryKey: ['hasAdmin'] });
  };

  const savePreference = async (uid: number) => {
    if ((editing?.preferredWeaponUid ?? null) !== prefUid) {
      await setPreferredWeapon(uid, prefUid);
    }
  };

  const save = useMutation({
    mutationFn: async (v: MemberForm) => {
      const u = editing ? await updateUser({ ...v, uid: editing.uid }) : await createUser(v);
      // A failed preference save leaves the modal open — make the retry an
      // update of the row we just created, not a second create.
      if (!editing) setEditing(u);
      await savePreference(u.uid);
      return u;
    },
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
      await savePreference(editing.uid);
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
    },
    onError,
  });

  const promoteMut = useMutation({
    mutationFn: (uid: number) => promoteGuest(uid),
    onSuccess: () => {
      notifications.show({ message: t('promoted_ok') });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError,
  });

  const openCreate = () => {
    setEditing(null);
    setPrefUid(null);
    form.setValues(EMPTY);
    form.resetDirty(EMPTY);
    open();
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setPrefUid(u.preferredWeaponUid ?? null);
    form.setValues({
      name: u.name,
      email: u.email ?? '',
      phone: u.phone ?? '',
      address: u.address ?? '',
      ssn: u.ssn ?? '',
      isStaff: u.isStaff,
      isAdmin: u.isAdmin,
      notes: u.notes ?? '',
    });
    open();
  };

  const onSave = (v: MemberForm) => {
    save.mutate(v);
  };

  const onActivate = () => {
    if (form.validate().hasErrors) return;
    activate.mutate(form.values);
  };

  const openDeactivate = (u: User) => {
    setDeactivating(u);
    close();
  };

  const q = search.trim().toLowerCase();
  const filtered = (users.data ?? []).filter((u) => {
    if (view === 'active' && (!u.active || u.isGuest)) return false;
    if (view === 'inactive' && u.active) return false;
    if (view === 'guests' && !u.isGuest) return false;
    if (!q) return true;
    return [u.name, u.email, u.phone].some((f) =>
      f?.toLowerCase().includes(q),
    );
  });

  // Sort the filtered rows. Missing values (no tag / never shot) always sink to
  // the bottom regardless of direction; name is never null.
  const dir = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    if (sort.key === 'name') return a.name.localeCompare(b.name, 'sv') * dir;
    if (sort.key === 'lastShot') {
      const av = lastShotMap.get(a.uid);
      const bv = lastShotMap.get(b.uid);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv) * dir;
    }
    if (sort.key === 'assignedWeapon') {
      const av = assignedLabel(a);
      const bv = assignedLabel(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv, 'sv') * dir;
    }
    return 0;
  });

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <Table.Th>
      <UnstyledButton onClick={() => toggleSort(k)} style={{ fontWeight: 'inherit' }}>
        {label}
        {sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </UnstyledButton>
    </Table.Th>
  );

  const rows = sorted.map((u) => (
    <Table.Tr
      key={u.uid}
      opacity={u.active ? 1 : 0.5}
      style={{ cursor: 'pointer' }}
      onClick={() => setInfoUid(u.uid)}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {u.name}
          {!u.isStaff && (!u.ssn || !isValidSwedishSSN(u.ssn)) && (
            <Tooltip label={t('member_no_ssn_warning')} color="orange">
              <Text component="span" c="orange" size="sm">⚠</Text>
            </Tooltip>
          )}
          {debtMap.has(u.uid) && (
            <Badge color="red" variant="filled">
              {t('debt_badge', { amount: debtMap.get(u.uid) })}
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>{lastShotMap.has(u.uid) ? fmtDate(lastShotMap.get(u.uid)!) : '—'}</Table.Td>
      <Table.Td>
        {/* Tag number leads as a chip (same pattern as the logs table); the
            label drops the [x] suffix, inactive keeps its [disabled] marker. */}
        {(() => {
          const w = u.preferredWeaponUid != null ? weaponMap.get(u.preferredWeaponUid) : undefined;
          if (!w) return '';
          return (
            <Group gap="xs" wrap="nowrap">
              {w.active && w.displayId && (
                <Badge color="teal" variant="light" size="lg" radius="sm" style={{ flexShrink: 0 }}>
                  {w.displayId}
                </Badge>
              )}
              {weaponLabel(w.brand, w.model, w.caliber, null, w.active, t)}
            </Group>
          );
        })()}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {u.isStaff && <Badge color="grape">{t('staff')}</Badge>}
          {u.isGuest && <Badge color="cyan">{t('label_guest')}</Badge>}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          {isAdmin && u.isGuest && (
            <Button
              size="xs"
              variant="light"
              onClick={(e) => {
                e.stopPropagation();
                promoteMut.mutate(u.uid);
              }}
            >
              {t('promote_guest')}
            </Button>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              setDebtUser(u);
            }}
          >
            {t('debt')}
          </Button>
          {isAdmin && (
            <Button
              size="xs"
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(u);
              }}
            >
              {t('edit')}
            </Button>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    // Fill the shell (100vh − 64 header − 48 footer − 2×16 main padding) so the
    // table grows into the free space instead of leaving a void under it.
    <Stack style={{ height: 'calc(100vh - 144px)' }}>
      <Group>
        <TextInput
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Select
          data={[
            { value: 'active', label: t('filter_active') },
            { value: 'inactive', label: t('filter_inactive') },
            ...(isAdmin ? [{ value: 'guests', label: t('filter_guests') }] : []),
          ]}
          value={view}
          onChange={(v) => setView((v as 'active' | 'inactive' | 'guests') ?? 'active')}
          allowDeselect={false}
          w={160}
        />
        {isAdmin && <Button onClick={openCreate}>{t('new_member')}</Button>}
      </Group>

      {(users.data?.length ?? 0) === 0 ? (
        <Text c="dimmed">{t('no_members')}</Text>
      ) : filtered.length === 0 ? (
        <Text c="dimmed">{t('no_results')}</Text>
      ) : (
        <Table.ScrollContainer minWidth={700} style={{ flex: 1, minHeight: 0 }}>
          <Table striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <SortTh label={t('field_name')} k="name" />
                <SortTh label={t('field_last_shot')} k="lastShot" />
                <SortTh label={t('field_preferred_weapon')} k="assignedWeapon" />
                <Table.Th />
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* Create / edit */}
      <Modal
        opened={opened}
        onClose={close}
        title={editing ? t('edit_member') : t('new_member')}
        size="xl"
        centered
      >
        <form onSubmit={form.onSubmit(onSave)}>
          <Stack>
            <Grid gap="lg">
              <Grid.Col span={6}>
                <Stack>
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
                </Stack>
              </Grid.Col>
              <Grid.Col span={6}>
                <Stack>
                  <Group align="flex-end" gap="xs" wrap="nowrap">
                    <Input.Wrapper label={t('field_preferred_weapon')} style={{ flex: 1 }}>
                      <Button
                        fullWidth
                        variant="default"
                        justify="space-between"
                        rightSection="▾"
                        onClick={() => setPrefPickerOpen(true)}
                        c={prefWeapon ? undefined : 'dimmed'}
                      >
                        {prefWeapon
                          ? weaponLabel(
                              prefWeapon.brand,
                              prefWeapon.model,
                              prefWeapon.caliber,
                              prefWeapon.displayId,
                              prefWeapon.active,
                              t,
                            )
                          : t('none_set')}
                      </Button>
                    </Input.Wrapper>
                    {prefUid != null && (
                      <CloseButton
                        size="lg"
                        aria-label={t('clear_selection')}
                        onClick={() => setPrefUid(null)}
                      />
                    )}
                  </Group>
                  <Switch
                    label={t('field_is_staff')}
                    {...form.getInputProps('isStaff', { type: 'checkbox' })}
                  />
                  {isAdmin && (
                    <Checkbox label={t('field_admin')} {...form.getInputProps('isAdmin', { type: 'checkbox' })} />
                  )}
                  <Textarea
                    label={t('field_notes')}
                    autosize
                    minRows={2}
                    {...form.getInputProps('notes')}
                  />
                </Stack>
              </Grid.Col>
            </Grid>
            <Group justify="space-between">
              {isAdmin && editing && !editing.active ? (
                <Button
                  variant="subtle"
                  color="teal"
                  loading={activate.isPending}
                  onClick={onActivate}
                >
                  {t('activate')}
                </Button>
              ) : isAdmin && editing ? (
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

      {/* Deactivate */}
      <Modal
        opened={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={t('confirm_deactivate_title')}
        centered
      >
        <Stack>
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
                  clearDisplayId: true,
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
          debtUser ? userLabel(debtUser.name, debtUser.active, t, debtUser.isGuest) : ''
        }
        opened={debtUser != null}
        onClose={() => setDebtUser(null)}
      />

      <MemberInfoModal
        uid={infoUid}
        opened={infoUid != null}
        onClose={() => setInfoUid(null)}
      />

      <WeaponPickerModal
        opened={prefPickerOpen}
        onClose={() => setPrefPickerOpen(false)}
        onSelect={(uid) => {
          setPrefUid(uid);
          setPrefPickerOpen(false);
        }}
      />
    </Stack>
  );
}
