import { Stack, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// M0 placeholder for routes that real milestones (M1+) will replace.
export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t(titleKey)}</Title>
      <Text c="dimmed">{t('page_todo')}</Text>
    </Stack>
  );
}
