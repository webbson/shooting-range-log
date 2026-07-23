import {
  Group,
  Button,
  Table,
  Badge,
  Modal,
  TextInput,
  Textarea,
  Autocomplete,
  Select,
  Checkbox,
  Switch,
  Stack,
  Text,
  Chip,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { IconTag } from '@tabler/icons-react';
import {
  listWeapons,
  listUsers,
  createWeapon,
  updateWeapon,
  setWeaponActive,
  nextWeaponDisplayId,
  activeTagKeys,
  WEAPON_TAG_KEYS,
  type Weapon,
} from './api';
import { errorMessage } from './errors';
import { weaponLabel } from './labels';
import { CURATED_BRANDS, CURATED_CALIBERS, mergeSuggestions } from './weaponPresets';
import { ServiceModal } from './ServiceModal';
import { TagModal } from './TagModal';
import { useIsAdmin } from './useIsAdmin';

interface WeaponForm {
  displayId: string;
  brand: string;
  model: string;
  serial: string;
  caliber: string;
  notes: string;
}

const EMPTY: WeaponForm = {
  displayId: '',
  brand: '',
  model: '',
  serial: '',
  caliber: '',
  notes: '',
};

export function WeaponsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<Weapon | null>(null);

  // Deactivation flow (reason + optional tag release).
  const [deactivating, setDeactivating] = useState<Weapon | null>(null);
  const [reason, setReason] = useState('');
  const [clearId, setClearId] = useState(false);
  const [serviceWeapon, setServiceWeapon] = useState<Weapon | null>(null);
  const [tagWeapon, setTagWeapon] = useState<number | null>(null);

  // List view: active-only by default, with a search box + show-inactive toggle.
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [unassignedFilter, setUnassignedFilter] = useState(false);

  // Create-only: pre-fill brand/model/caliber from an existing weapon's spec.
  const [baseKey, setBaseKey] = useState<string | null>(null);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  // weapon uid → the member whose assigned weapon it is (at most one; DB-enforced).
  const assigneeMap = new Map(
    (users.data ?? [])
      .filter((u) => u.preferredWeaponUid != null)
      .map((u) => [u.preferredWeaponUid as number, u] as const),
  );
  const form = useForm<WeaponForm>({ initialValues: EMPTY });

  // Field suggestions: curated presets ∪ values already in the DB (self-enriching).
  // Free-text is preserved — these only populate the Autocomplete dropdowns.
  const all = weapons.data ?? [];
  const brands = useMemo(
    () => mergeSuggestions(CURATED_BRANDS, all.map((w) => w.brand)),
    [all],
  );
  const calibers = useMemo(
    () => mergeSuggestions(CURATED_CALIBERS, all.map((w) => w.caliber)),
    [all],
  );
  const brandSel = form.values.brand.trim().toLowerCase();
  const models = useMemo(
    () =>
      mergeSuggestions(
        [],
        all
          .filter((w) => !brandSel || w.brand?.trim().toLowerCase() === brandSel)
          .map((w) => w.model),
      ),
    [all, brandSel],
  );

  // Distinct brand/model/caliber specs from existing weapons (no tag/[id]),
  // keyed on the tuple so each combo appears once.
  const baseSpecs = useMemo(() => {
    const map = new Map<
      string,
      { brand: string; model: string; caliber: string; label: string; createdAt: string }
    >();
    for (const w of all) {
      const brand = w.brand ?? '';
      const model = w.model ?? '';
      const caliber = w.caliber ?? '';
      const label = [[brand, model].filter(Boolean).join(' '), caliber]
        .filter(Boolean)
        .join(', ');
      if (!label) continue;
      const key = `${brand}|${model}|${caliber}`.toLowerCase();
      const prev = map.get(key);
      // Track the most recent weapon carrying this spec (RFC3339 sorts chronologically).
      if (!prev) map.set(key, { brand, model, caliber, label, createdAt: w.createdAt });
      else if (w.createdAt > prev.createdAt) prev.createdAt = w.createdAt;
    }
    return map;
  }, [all]);

  // Newest spec first (by most recent weapon added with that spec).
  const baseData = useMemo(
    () =>
      [...baseSpecs.entries()]
        .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
        .map(([value, s]) => ({ value, label: s.label })),
    [baseSpecs],
  );

  const onBase = (val: string | null) => {
    setBaseKey(val);
    if (!val) return;
    const s = baseSpecs.get(val);
    if (!s) return;
    form.setFieldValue('brand', s.brand);
    form.setFieldValue('model', s.model);
    form.setFieldValue('caliber', s.caliber);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ['weapons'] });
  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  // An active weapon (a new one, or an existing active one being edited) must
  // carry an ID. Inactive weapons may have it cleared. Rust enforces this too.
  const idRequired = !editing || editing.active;

  const save = useMutation({
    mutationFn: (v: WeaponForm) =>
      editing ? updateWeapon({ ...v, uid: editing.uid }) : createWeapon(v),
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  // Activate an inactive weapon: persist the (possibly newly entered) ID first,
  // then flip it active.
  const activate = useMutation({
    mutationFn: async (v: WeaponForm) => {
      if (!editing) throw new Error('no weapon');
      await updateWeapon({ ...v, uid: editing.uid });
      return setWeaponActive(editing.uid, true);
    },
    onSuccess: () => {
      invalidate();
      close();
      notifications.show({ message: t('saved') });
    },
    onError,
  });

  const suggestId = useMutation({
    mutationFn: nextWeaponDisplayId,
    onSuccess: (id) => form.setFieldValue('displayId', id),
    onError,
  });

  const setActive = useMutation({
    mutationFn: (args: {
      uid: number;
      active: boolean;
      reason?: string;
      clearDisplayId?: boolean;
    }) => setWeaponActive(args.uid, args.active, args.reason, args.clearDisplayId),
    onSuccess: () => {
      invalidate();
      setDeactivating(null);
      setReason('');
      setClearId(false);
    },
    onError,
  });

  const openCreate = () => {
    setEditing(null);
    setBaseKey(null);
    form.setValues(EMPTY);
    form.resetDirty(EMPTY);
    open();
  };

  const openEdit = (w: Weapon) => {
    setEditing(w);
    form.setValues({
      displayId: w.displayId ?? '',
      brand: w.brand ?? '',
      model: w.model ?? '',
      serial: w.serial ?? '',
      caliber: w.caliber ?? '',
      notes: w.notes ?? '',
    });
    open();
  };

  const onSave = (v: WeaponForm) => {
    if (idRequired && !v.displayId.trim()) {
      form.setFieldError('displayId', t('display_id_required'));
      return;
    }
    save.mutate(v);
  };

  const onActivate = () => {
    const v = form.values;
    if (!v.displayId.trim()) {
      form.setFieldError('displayId', t('display_id_required'));
      return;
    }
    activate.mutate(v);
  };

  const openDeactivate = (w: Weapon) => {
    setReason('');
    setClearId(false);
    setDeactivating(w);
    close();
  };

  const q = search.trim().toLowerCase();
  const filtered = (weapons.data ?? []).filter((w) => {
    if (!showInactive && !w.active) return false;
    if (tagFilter.length > 0 && !activeTagKeys(w).some((k) => tagFilter.includes(k))) return false;
    if (unassignedFilter && assigneeMap.has(w.uid)) return false;
    if (!q) return true;
    return [w.displayId, w.brand, w.model, w.serial, w.caliber].some((f) =>
      f?.toLowerCase().includes(q),
    );
  });

  const rows = filtered.map((w) => (
    <Table.Tr key={w.uid} opacity={w.active ? 1 : 0.5}>
      <Table.Td>{w.displayId}</Table.Td>
      <Table.Td>{w.brand}</Table.Td>
      <Table.Td>{w.model}</Table.Td>
      <Table.Td>{w.serial}</Table.Td>
      <Table.Td>{w.caliber}</Table.Td>
      <Table.Td>{assigneeMap.get(w.uid)?.name ?? ''}</Table.Td>
      <Table.Td>
        <Badge color={w.active ? 'teal' : 'gray'} variant="light">
          {w.active ? t('active') : t('inactive')}
        </Badge>
        {!w.active && w.inactiveReason && (
          <Text size="xs" c="dimmed">
            {w.inactiveReason}
          </Text>
        )}
        {activeTagKeys(w).map((k) => (
          <Badge key={k} color="orange" variant="light" size="sm">
            {t(`tag_${k}`)}
          </Badge>
        ))}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Tooltip label={t('edit_tags')}>
            <ActionIcon
              variant="subtle"
              color="orange"
              size="lg"
              aria-label={t('edit_tags')}
              onClick={() => setTagWeapon(w.uid)}
            >
              <IconTag />
            </ActionIcon>
          </Tooltip>
          <Button size="xs" variant="subtle" onClick={() => setServiceWeapon(w)}>
            {t('service')}
          </Button>
          {isAdmin && (
            <Button size="xs" variant="default" onClick={() => openEdit(w)}>
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
        <Switch
          label={t('show_inactive')}
          checked={showInactive}
          onChange={(e) => setShowInactive(e.currentTarget.checked)}
        />
        {isAdmin && <Button onClick={openCreate}>{t('new_weapon')}</Button>}
      </Group>

      {(weapons.data?.length ?? 0) === 0 ? (
        <Text c="dimmed">{t('no_weapons')}</Text>
      ) : (
        <>
          <Group gap="xs">
            <Chip.Group multiple value={tagFilter} onChange={setTagFilter}>
              <Group gap="xs">
                {WEAPON_TAG_KEYS.map((k) => (
                  <Chip key={k} value={k} size="sm" color="orange">
                    {t(`tag_${k}`)}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Chip
              checked={unassignedFilter}
              onChange={setUnassignedFilter}
              size="sm"
            >
              {t('filter_unassigned_only')}
            </Chip>
          </Group>
          {filtered.length === 0 ? (
            <Text c="dimmed">{t('no_results')}</Text>
          ) : (
            <Table.ScrollContainer minWidth={700} style={{ flex: 1, minHeight: 0 }}>
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('field_display_id')}</Table.Th>
                    <Table.Th>{t('field_brand')}</Table.Th>
                    <Table.Th>{t('field_model')}</Table.Th>
                    <Table.Th>{t('field_serial')}</Table.Th>
                    <Table.Th>{t('field_caliber')}</Table.Th>
                    <Table.Th>{t('assigned_to')}</Table.Th>
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
        title={editing ? t('edit_weapon') : t('new_weapon')}
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
            {!editing && (
              <Select
                label={t('base_on_weapon')}
                placeholder={t('base_on_weapon_ph')}
                data={baseData}
                value={baseKey}
                onChange={onBase}
                searchable
                clearable
              />
            )}
            <Group grow>
              <Autocomplete
                label={t('field_brand')}
                data={brands}
                {...form.getInputProps('brand')}
              />
              <Autocomplete
                label={t('field_model')}
                data={models}
                {...form.getInputProps('model')}
              />
            </Group>
            <Group grow>
              <TextInput label={t('field_serial')} {...form.getInputProps('serial')} />
              <Autocomplete
                label={t('field_caliber')}
                data={calibers}
                {...form.getInputProps('caliber')}
              />
            </Group>
            <Textarea
              label={t('field_notes')}
              autosize
              minRows={2}
              {...form.getInputProps('notes')}
            />
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

      {/* Deactivate reason + optional tag release */}
      <Modal
        opened={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={t('confirm_deactivate_title')}
        centered
      >
        <Stack>
          <TextInput
            label={t('inactive_reason')}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            data-autofocus
          />
          <Checkbox
            label={t('clear_display_id')}
            checked={clearId}
            onChange={(e) => setClearId(e.currentTarget.checked)}
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
                  reason: reason.trim() || undefined,
                  clearDisplayId: clearId,
                })
              }
            >
              {t('deactivate')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ServiceModal
        weaponUid={serviceWeapon?.uid ?? null}
        weaponLabel={
          serviceWeapon
            ? weaponLabel(
                serviceWeapon.brand,
                serviceWeapon.model,
                serviceWeapon.caliber,
                serviceWeapon.displayId,
                serviceWeapon.active,
                t,
              )
            : ''
        }
        opened={serviceWeapon != null}
        onClose={() => setServiceWeapon(null)}
      />

      <TagModal weaponUid={tagWeapon} opened={tagWeapon != null} onClose={() => setTagWeapon(null)} />
    </Stack>
  );
}
