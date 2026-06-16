import {
  Group,
  Title,
  Button,
  Table,
  Badge,
  Modal,
  TextInput,
  Textarea,
  Checkbox,
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
  listWeapons,
  createWeapon,
  updateWeapon,
  setWeaponActive,
  nextWeaponDisplayId,
  type Weapon,
} from './api';
import { errorMessage } from './errors';
import { weaponLabel } from './labels';
import { ServiceModal } from './ServiceModal';

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
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<Weapon | null>(null);

  // Deactivation flow (reason + optional tag release).
  const [deactivating, setDeactivating] = useState<Weapon | null>(null);
  const [reason, setReason] = useState('');
  const [clearId, setClearId] = useState(false);
  const [serviceWeapon, setServiceWeapon] = useState<Weapon | null>(null);

  // List view: active-only by default, with a search box + show-inactive toggle.
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const form = useForm<WeaponForm>({ initialValues: EMPTY });

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
      <Table.Td>
        <Badge color={w.active ? 'teal' : 'gray'} variant="light">
          {w.active ? t('active') : t('inactive')}
        </Badge>
        {!w.active && w.inactiveReason && (
          <Text size="xs" c="dimmed">
            {w.inactiveReason}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Button size="xs" variant="subtle" onClick={() => setServiceWeapon(w)}>
            {t('service')}
          </Button>
          <Button size="xs" variant="default" onClick={() => openEdit(w)}>
            {t('edit')}
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav_weapons')}</Title>
        <Button onClick={openCreate}>{t('new_weapon')}</Button>
      </Group>

      {(weapons.data?.length ?? 0) === 0 ? (
        <Text c="dimmed">{t('no_weapons')}</Text>
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
                    <Table.Th>{t('field_brand')}</Table.Th>
                    <Table.Th>{t('field_model')}</Table.Th>
                    <Table.Th>{t('field_serial')}</Table.Th>
                    <Table.Th>{t('field_caliber')}</Table.Th>
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
            <Group grow>
              <TextInput label={t('field_brand')} {...form.getInputProps('brand')} />
              <TextInput label={t('field_model')} {...form.getInputProps('model')} />
            </Group>
            <Group grow>
              <TextInput label={t('field_serial')} {...form.getInputProps('serial')} />
              <TextInput label={t('field_caliber')} {...form.getInputProps('caliber')} />
            </Group>
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
                serviceWeapon.displayId,
                serviceWeapon.active,
                t,
              )
            : ''
        }
        opened={serviceWeapon != null}
        onClose={() => setServiceWeapon(null)}
      />
    </Stack>
  );
}
