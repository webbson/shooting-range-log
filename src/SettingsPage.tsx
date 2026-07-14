import { useState, useEffect } from 'react';
import {
  Stack,
  Title,
  Text,
  Button,
  Select,
  Group,
  Badge,
  Card,
  Box,
  Divider,
  Loader,
  Checkbox,
  Alert,
  TextInput,
  PasswordInput,
  Table,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';

import {
  importListSheets,
  importPreview,
  importCommit,
  getSettings,
  updateSettings,
  testS3Connection,
  backupNow,
  listBackups,
  restoreBackup,
  type ImportPreview,
  type ImportResult,
  type Settings,
  type BackupInfo,
  type BackupSource,
} from './api';
import { errorMessage } from './errors';

const DEFAULT_SETTINGS: Settings = {
  s3Endpoint: null,
  s3Region: null,
  s3Bucket: null,
  s3Prefix: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  backupPassphrase: null,
};

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Excel import state ──
  const [filePath, setFilePath] = useState<string | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [markOpenReturned, setMarkOpenReturned] = useState(false);

  // ── Backup settings state ──
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);

  const { data: savedSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  // Populate form when settings load from DB.
  useEffect(() => {
    if (savedSettings) setForm(savedSettings);
  }, [savedSettings]);

  // Fetch sheet names whenever a file is picked.
  const { data: sheets, isLoading: sheetsLoading } = useQuery({
    queryKey: ['import_sheets', filePath],
    queryFn: () => importListSheets(filePath!),
    enabled: !!filePath,
  });

  // Default to the first "utlåning"-named sheet when list loads.
  useEffect(() => {
    if (sheets && sheets.length > 0) {
      const auto = sheets.find((s) => /utl[åa]ning/i.test(s)) ?? sheets[0];
      setSelectedSheet(auto);
    }
  }, [sheets]);

  // Clear preview whenever file or sheet changes.
  useEffect(() => {
    setPreview(null);
  }, [filePath, selectedSheet]);

  const onError = (e: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(e, t) });

  const settingsMut = useMutation<void, unknown, Settings>({
    mutationFn: (s) => updateSettings(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({ color: 'green', message: t('settings_saved') });
    },
    onError,
  });

  const testConnMut = useMutation<string, unknown, void>({
    mutationFn: () => testS3Connection(form),
    onSuccess: (bucket) =>
      notifications.show({ color: 'green', message: t('backup_test_ok', { bucket }) }),
    onError,
  });

  const backupNowMut = useMutation<string, unknown, void>({
    mutationFn: backupNow,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      notifications.show({ color: 'green', message: t('backup_now_ok') });
    },
    onError,
  });

  const restoreMut = useMutation<void, unknown, { filename: string; source: BackupSource }>({
    mutationFn: ({ filename, source }) => restoreBackup(filename, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['weapons'] });
      qc.invalidateQueries({ queryKey: ['checkouts'] });
      qc.invalidateQueries({ queryKey: ['backups'] });
      notifications.show({ color: 'green', message: t('backup_restore_ok') });
      setConfirmingRestore(null);
    },
    onError,
  });

  const { data: backupList = [], refetch: refetchBackups } = useQuery({
    queryKey: ['backups'],
    queryFn: listBackups,
  });

  const [confirmingRestore, setConfirmingRestore] = useState<BackupInfo | null>(null);

  const previewMut = useMutation<ImportPreview, unknown, void>({
    mutationFn: () => importPreview(filePath!, selectedSheet!),
    onSuccess: (p) => setPreview(p),
    onError,
  });

  const commitMut = useMutation<ImportResult, unknown, void>({
    mutationFn: () => importCommit(filePath!, selectedSheet!, markOpenReturned),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['weapons'] });
      qc.invalidateQueries({ queryKey: ['checkouts'] });
      notifications.show({
        color: 'green',
        message: t('import_done', {
          membersCreated: result.membersCreated,
          weaponsCreated: result.weaponsCreated,
          loansCreated: result.loansCreated,
        }),
      });
      if (result.warnings.length > 0) {
        notifications.show({
          color: 'orange',
          autoClose: false,
          title: t('import_warnings'),
          message: result.warnings.map((w) => w.message).join('\n'),
        });
      }
      setPreview(null);
      setFilePath(null);
      setSelectedSheet(null);
      setMarkOpenReturned(false);
    },
    onError,
  });

  const pickFile = async () => {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    });
    const path = typeof result === 'string' ? result : null;
    if (path) {
      setFilePath(path);
      setPreview(null);
      setSelectedSheet(null);
    }
  };

  const canPreview = !!filePath && !!selectedSheet && !previewMut.isPending;
  const canCommit = !!preview && !commitMut.isPending;

  return (
    <Stack>
      <Title order={2}>{t('settings_title')}</Title>

      {/* ── Excel import ── */}
      <Card withBorder>
        <Stack gap="md">
          <Title order={4}>{t('import_title')}</Title>
          <Text size="sm" c="dimmed">{t('import_desc')}</Text>

          {/* File picker */}
          <Group align="center" gap="sm">
            <Button variant="default" size="sm" onClick={pickFile}>
              {t('import_pick_file')}
            </Button>
            <Text size="sm" c={filePath ? undefined : 'dimmed'} truncate maw={500}>
              {filePath ?? t('import_no_file')}
            </Text>
          </Group>

          {/* Sheet selector — visible once a file is loaded */}
          {filePath && (
            <Group align="flex-end" gap="sm">
              {sheetsLoading ? (
                <Loader size="sm" />
              ) : (
                <Select
                  label={t('import_select_sheet')}
                  data={sheets ?? []}
                  value={selectedSheet}
                  onChange={(v) => setSelectedSheet(v)}
                  w={240}
                />
              )}
              <Button
                variant="default"
                size="sm"
                loading={previewMut.isPending}
                disabled={!canPreview}
                onClick={() => previewMut.mutate()}
              >
                {t('import_preview_btn')}
              </Button>
            </Group>
          )}

          {/* Preview results */}
          {preview && (
            <>
              <Divider label={t('import_preview_title')} labelPosition="left" />
              <Stack gap="xs">
                <PreviewRow label={t('import_members_create')} value={preview.membersToCreate} color="blue" />
                <PreviewRow label={t('import_members_match')} value={preview.membersToMatch} color="gray" />
                <PreviewRow label={t('import_weapons_create')} value={preview.weaponsToCreate} color="blue" />
                <PreviewRow label={t('import_weapons_existing')} value={preview.weaponsExisting} color="gray" />
                <PreviewRow label={t('import_loans_create')} value={preview.loansToCreate} color="blue" />
                <PreviewRow label={t('import_loans_skip')} value={preview.loansSkippedDuplicate} color="gray" />
              </Stack>

              {preview.openLoans > 0 && (
                <Alert color="orange" variant="light">
                  <Stack gap="xs">
                    <Text size="sm">
                      {t('import_open_loans_warning', { count: preview.openLoans })}
                    </Text>
                    <Checkbox
                      label={t('import_mark_open_returned')}
                      checked={markOpenReturned}
                      onChange={(e) => setMarkOpenReturned(e.currentTarget.checked)}
                    />
                  </Stack>
                </Alert>
              )}

              {preview.warnings.length > 0 && (
                <Box>
                  <Text size="sm" fw={500} mb={4}>
                    {t('import_warnings')} ({preview.warnings.length})
                  </Text>
                  <Box
                    mah={180}
                    style={{
                      overflowY: 'auto',
                      border: '1px solid var(--mantine-color-orange-3)',
                      borderRadius: 'var(--mantine-radius-sm)',
                      padding: '6px 10px',
                    }}
                  >
                    {preview.warnings.map((w, i) => (
                      <Text key={i} size="xs" c="orange">
                        {w.message}
                      </Text>
                    ))}
                  </Box>
                </Box>
              )}

              <Group justify="flex-end">
                <Button
                  color="blue"
                  loading={commitMut.isPending}
                  disabled={!canCommit}
                  onClick={() => commitMut.mutate()}
                >
                  {t('import_run_btn')}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Card>

      {/* ── Backup settings (M6) ── */}
      <Card withBorder>
        <Stack gap="md">
          <Title order={4}>{t('nav_backup')}</Title>

          {/* S3 configuration */}
          <Divider label={t('backup_s3_title')} labelPosition="left" />
          <Text size="sm" c="dimmed">{t('backup_s3_desc')}</Text>
          <TextInput
            label={t('backup_s3_endpoint')}
            placeholder="https://<account-id>.r2.cloudflarestorage.com"
            value={form.s3Endpoint ?? ''}
            onChange={(e) => setForm({ ...form, s3Endpoint: e.target.value || null })}
          />
          <Group grow>
            <TextInput
              label={t('backup_s3_region')}
              placeholder="auto"
              description={t('backup_s3_region_hint')}
              value={form.s3Region ?? ''}
              onChange={(e) => setForm({ ...form, s3Region: e.target.value || null })}
            />
            <TextInput
              label={t('backup_s3_bucket')}
              value={form.s3Bucket ?? ''}
              onChange={(e) => setForm({ ...form, s3Bucket: e.target.value || null })}
            />
          </Group>
          <TextInput
            label={t('backup_s3_prefix')}
            placeholder="srl-backups"
            value={form.s3Prefix ?? ''}
            onChange={(e) => setForm({ ...form, s3Prefix: e.target.value || null })}
          />
          <Group grow>
            <TextInput
              label={t('backup_s3_access_key_id')}
              value={form.s3AccessKeyId ?? ''}
              onChange={(e) => setForm({ ...form, s3AccessKeyId: e.target.value || null })}
            />
            <PasswordInput
              label={t('backup_s3_secret_key')}
              value={form.s3SecretAccessKey ?? ''}
              onChange={(e) => setForm({ ...form, s3SecretAccessKey: e.target.value || null })}
            />
          </Group>

          <Group justify="flex-end">
            <Button
              variant="default"
              size="sm"
              loading={testConnMut.isPending}
              onClick={() => testConnMut.mutate()}
            >
              {t('backup_test_connection')}
            </Button>
          </Group>

          {/* Encryption passphrase */}
          <Divider label={t('backup_passphrase_title')} labelPosition="left" />
          <Alert color="orange" variant="light">
            <Text size="sm">{t('backup_passphrase_warning')}</Text>
          </Alert>
          <PasswordInput
            label={t('backup_passphrase')}
            value={form.backupPassphrase ?? ''}
            onChange={(e) => setForm({ ...form, backupPassphrase: e.target.value || null })}
          />

          <Group justify="flex-end">
            <Button
              color="blue"
              loading={settingsMut.isPending}
              onClick={() => settingsMut.mutate(form)}
            >
              {t('backup_save_btn')}
            </Button>
          </Group>

          {/* Backup operations */}
          <Divider label={t('backup_list_title')} labelPosition="left" />
          <Group>
            <Button
              variant="default"
              size="sm"
              loading={backupNowMut.isPending}
              onClick={() => backupNowMut.mutate()}
            >
              {t('backup_now_btn')}
            </Button>
            <Button variant="subtle" size="sm" onClick={() => refetchBackups()}>
              ↺
            </Button>
          </Group>

          {/* Remote-newer alert */}
          {(() => {
            const newest_local = backupList.find((b) => b.source === 'local');
            const newest_remote = backupList.find((b) => b.source === 'remote');
            if (
              newest_remote &&
              (!newest_local || newest_remote.timestamp > newest_local.timestamp)
            ) {
              return (
                <Alert color="blue" variant="light">
                  <Text size="sm">{t('backup_remote_newer')}</Text>
                </Alert>
              );
            }
            return null;
          })()}

          {/* Restore confirmation inline */}
          {confirmingRestore && (
            <Alert color="red" variant="light">
              <Stack gap="xs">
                <Text size="sm" fw={500}>{t('backup_restore_confirm')}</Text>
                <Text size="sm">{t('backup_restore_confirm_detail')}</Text>
                <Text size="xs" c="dimmed">{confirmingRestore.filename}</Text>
                <Group>
                  <Button
                    color="red"
                    size="xs"
                    loading={restoreMut.isPending}
                    onClick={() =>
                      restoreMut.mutate({
                        filename: confirmingRestore.filename,
                        source: confirmingRestore.source,
                      })
                    }
                  >
                    {t('backup_restore_btn')}
                  </Button>
                  <Button
                    variant="default"
                    size="xs"
                    onClick={() => setConfirmingRestore(null)}
                  >
                    {t('cancel')}
                  </Button>
                </Group>
              </Stack>
            </Alert>
          )}

          {/* Backup list */}
          {backupList.length === 0 ? (
            <Text size="sm" c="dimmed">{t('backup_no_backups')}</Text>
          ) : (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('backup_ts')}</Table.Th>
                  <Table.Th>{t('backup_source')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {backupList.map((b) => (
                  <Table.Tr key={`${b.source}-${b.filename}`}>
                    <Table.Td>
                      <Text size="sm">{b.timestamp.slice(0, 16).replace('T', ' ')}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={b.source === 'local' ? 'gray' : 'blue'}
                        variant="light"
                      >
                        {t(b.source === 'local' ? 'backup_source_local' : 'backup_source_remote')}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Button
                        variant="default"
                        size="xs"
                        loading={restoreMut.isPending && confirmingRestore?.filename === b.filename}
                        onClick={() => setConfirmingRestore(b)}
                      >
                        {t('backup_restore_btn')}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function PreviewRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Group justify="space-between" maw={360}>
      <Text size="sm">{label}</Text>
      <Badge color={color} variant="light">
        {value}
      </Badge>
    </Group>
  );
}
