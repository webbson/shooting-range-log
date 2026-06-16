import {
  Group,
  Title,
  Button,
  Table,
  Badge,
  Modal,
  TextInput,
  Textarea,
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
  type Weapon,
} from './api';
import { errorMessage } from './errors';
import { ServiceModal } from './ServiceModal';

interface WeaponForm {
  displayId: string;
  brand: string;
  model: string;
  serial: string;
  notes: string;
}

const EMPTY: WeaponForm = { displayId: '', brand: '', model: '', serial: '', notes: '' };

export function WeaponsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<Weapon | null>(null);

  // Deactivation reason flow.
  const [deactivating, setDeactivating] = useState<Weapon | null>(null);
  const [reason, setReason] = useState('');
  const [serviceWeapon, setServiceWeapon] = useState<Weapon | null>(null);

  const weapons = useQuery({ queryKey: ['weapons'], queryFn: listWeapons });
  const form = useForm<WeaponForm>({ initialValues: EMPTY });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['weapons'] });
  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

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

  const setActive = useMutation({
    mutationFn: (args: { uid: number; active: boolean; reason?: string }) =>
      setWeaponActive(args.uid, args.active, args.reason),
    onSuccess: () => {
      invalidate();
      setDeactivating(null);
      setReason('');
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
      notes: w.notes ?? '',
    });
    open();
  };

  const rows = (weapons.data ?? []).map((w) => (
    <Table.Tr key={w.uid} opacity={w.active ? 1 : 0.5}>
      <Table.Td>{w.displayId}</Table.Td>
      <Table.Td>{w.brand}</Table.Td>
      <Table.Td>{w.model}</Table.Td>
      <Table.Td>{w.serial}</Table.Td>
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
          {w.active ? (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => {
                setReason('');
                setDeactivating(w);
              }}
            >
              {t('deactivate')}
            </Button>
          ) : (
            <Button
              size="xs"
              variant="subtle"
              color="teal"
              onClick={() => setActive.mutate({ uid: w.uid, active: true })}
            >
              {t('activate')}
            </Button>
          )}
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
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('field_display_id')}</Table.Th>
                <Table.Th>{t('field_brand')}</Table.Th>
                <Table.Th>{t('field_model')}</Table.Th>
                <Table.Th>{t('field_serial')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
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
        title={editing ? t('edit_weapon') : t('new_weapon')}
        centered
      >
        <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
          <Stack>
            <TextInput label={t('field_display_id')} {...form.getInputProps('displayId')} />
            <Group grow>
              <TextInput label={t('field_brand')} {...form.getInputProps('brand')} />
              <TextInput label={t('field_model')} {...form.getInputProps('model')} />
            </Group>
            <TextInput label={t('field_serial')} {...form.getInputProps('serial')} />
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

      {/* Deactivate reason */}
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
            ? [serviceWeapon.displayId, serviceWeapon.brand, serviceWeapon.model]
                .filter(Boolean)
                .join(' · ')
            : ''
        }
        opened={serviceWeapon != null}
        onClose={() => setServiceWeapon(null)}
      />
    </Stack>
  );
}
