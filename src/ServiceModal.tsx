import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  Button,
  Divider,
  ScrollArea,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { listWeaponService, addService } from './api';
import { useAppStore } from './store';
import { errorMessage } from './errors';
import { fmtDate } from './format';

interface ServiceForm {
  description: string;
  notes: string;
  servicedAt: string;
}

export function ServiceModal({
  weaponUid,
  weaponLabel,
  opened,
  onClose,
}: {
  weaponUid: number | null;
  weaponLabel: string;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const operator = useAppStore((s) => s.operator);

  const entries = useQuery({
    queryKey: ['weaponService', weaponUid],
    queryFn: () => listWeaponService(weaponUid!),
    enabled: opened && weaponUid != null,
  });

  const form = useForm<ServiceForm>({
    initialValues: { description: '', notes: '', servicedAt: dayjs().format('YYYY-MM-DD') },
    validate: { description: (v) => (v.trim() ? null : t('err_service_description_required')) },
  });

  const add = useMutation({
    mutationFn: (v: ServiceForm) =>
      addService(weaponUid!, operator!.uid, v.description, v.notes || undefined, v.servicedAt || undefined),
    onSuccess: () => {
      form.reset();
      qc.invalidateQueries({ queryKey: ['weaponService', weaponUid] });
      notifications.show({ message: t('saved') });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${t('service_for')} ${weaponLabel}`}
      centered
      size="lg"
    >
      <Stack>
        <form onSubmit={form.onSubmit((v) => add.mutate(v))}>
          <Stack>
            <TextInput
              label={t('field_description')}
              withAsterisk
              {...form.getInputProps('description')}
            />
            <Group grow align="flex-start">
              <DateInput
                label={t('field_serviced_at')}
                valueFormat="YYYY-MM-DD"
                value={form.values.servicedAt || null}
                onChange={(v) => form.setFieldValue('servicedAt', v ?? '')}
                clearable
              />
              <TextInput label={t('field_notes')} {...form.getInputProps('notes')} />
            </Group>
            <Group justify="flex-end">
              <Button type="submit" loading={add.isPending} disabled={!operator}>
                {t('add_service_entry')}
              </Button>
            </Group>
          </Stack>
        </form>

        <Divider />

        <ScrollArea.Autosize mah={320}>
          <Stack gap="xs">
            {(entries.data?.length ?? 0) === 0 ? (
              <Text c="dimmed">{t('no_service')}</Text>
            ) : (
              (entries.data ?? []).map((s) => (
                <Stack key={s.id} gap={0}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600}>{s.description}</Text>
                    <Text size="xs" c="dimmed">
                      {fmtDate(s.servicedAt)}
                    </Text>
                  </Group>
                  {s.notes && <Text size="sm">{s.notes}</Text>}
                  <Text size="xs" c="dimmed">
                    {t('operator')}: {s.operatorName}
                  </Text>
                  <Divider mt="xs" />
                </Stack>
              ))
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}
