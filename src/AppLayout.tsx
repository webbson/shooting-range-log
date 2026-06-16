import {
  AppShell,
  Group,
  Title,
  Button,
  Text,
  Badge,
  SegmentedControl,
  ActionIcon,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, type Lang } from './store';
import { dbHealth } from './api';

const NAV = [
  { to: '/checkout', key: 'nav_checkout' },
  { to: '/members', key: 'nav_members' },
  { to: '/weapons', key: 'nav_weapons' },
  { to: '/logs', key: 'nav_logs' },
  { to: '/backup', key: 'nav_backup' },
] as const;

export function AppLayout() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const operatorName = useAppStore((s) => s.operatorName);

  const { toggleColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');

  const health = useQuery({ queryKey: ['db_health'], queryFn: dbHealth });

  return (
    <AppShell header={{ height: 64 }} footer={{ height: 48 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Title order={3}>{t('app_title')}</Title>
          <Group gap="xs" wrap="nowrap">
            {NAV.map((item) => (
              <Button
                key={item.to}
                component={NavLink}
                to={item.to}
                variant="subtle"
                size="md"
              >
                {t(item.key)}
              </Button>
            ))}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>

      <AppShell.Footer>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {t('operator')}:
            </Text>
            <Badge color={operatorName ? 'blue' : 'gray'} variant="light">
              {operatorName ?? t('no_operator')}
            </Badge>
          </Group>

          <Group gap="md">
            <Text size="sm" c={health.isError ? 'red' : 'dimmed'}>
              {t('db_status')}:{' '}
              {health.isLoading
                ? t('db_checking')
                : health.isError
                  ? t('db_error')
                  : health.data}
            </Text>
            <SegmentedControl
              size="xs"
              value={language}
              onChange={(v) => setLanguage(v as Lang)}
              data={[
                { label: 'SV', value: 'sv' },
                { label: 'EN', value: 'en' },
              ]}
            />
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={t('theme')}
              onClick={toggleColorScheme}
            >
              {computed === 'dark' ? '☀' : '🌙'}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
}
