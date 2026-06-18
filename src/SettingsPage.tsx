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
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';

import {
  importListSheets,
  importPreview,
  importCommit,
  type ImportPreview,
  type ImportResult,
} from './api';
import { errorMessage } from './errors';

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [markOpenReturned, setMarkOpenReturned] = useState(false);

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

      {/* ── Backup (stub — M6) ── */}
      <Card withBorder>
        <Stack gap="xs">
          <Title order={4}>{t('nav_backup')}</Title>
          <Text c="dimmed">{t('page_todo')}</Text>
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
