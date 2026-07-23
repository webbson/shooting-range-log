import { save } from '@tauri-apps/plugin-dialog';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { exportCsvCmd, type ExportKind } from './api';
import { errorMessage } from './errors';

export function useExportCsv() {
  const { t } = useTranslation();
  return async (
    kind: ExportKind,
    defaultName: string,
    params: { from?: string | null; to?: string | null; months?: number | null } = {},
  ) => {
    try {
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      const n = await exportCsvCmd(kind, path, params.from, params.to, params.months);
      notifications.show({ message: t('export_done', { count: n }) });
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
}
