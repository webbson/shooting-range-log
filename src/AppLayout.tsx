import { useState, useEffect } from 'react';
import {
  AppShell,
  Group,
  Button,
  Text,
  Badge,
  Tooltip,
  SegmentedControl,
  ActionIcon,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { IconMaximize, IconMinimize } from '@tabler/icons-react';
import { useAppStore, type Lang } from './store';
import { dbHealth, listBackups, listOpenCheckouts } from './api';
import { OperatorPicker } from './OperatorPicker';
import { useIsAdmin } from './useIsAdmin';

const NAV = [
  { to: '/checkout', key: 'nav_checkout' },
  { to: '/checkin', key: 'nav_checkin' },
  { to: '/members', key: 'nav_members' },
  { to: '/weapons', key: 'nav_weapons' },
  { to: '/logs', key: 'nav_logs' },
  { to: '/stats', key: 'nav_stats' },
  { to: '/maintenance', key: 'nav_maintenance' },
] as const;

export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const operator = useAppStore((s) => s.operator);
  const setOperator = useAppStore((s) => s.setOperator);
  const isAdmin = useIsAdmin();
  const fullscreen = useAppStore((s) => s.fullscreen);
  const setFullscreen = useAppStore((s) => s.setFullscreen);

  // Applies the toggle and, on mount, restores the persisted mode from launch.
  useEffect(() => {
    getCurrentWindow().setFullscreen(fullscreen).catch(console.warn);
  }, [fullscreen]);

  const { toggleColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');

  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('sv-SE'));
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString('sv-SE')), 1000);
    return () => clearInterval(id);
  }, []);

  const health = useQuery({ queryKey: ['db_health'], queryFn: dbHealth });
  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: listBackups,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
  const open = useQuery({
    queryKey: ['openCheckouts'],
    queryFn: listOpenCheckouts,
    refetchInterval: 30_000,
  });
  const openCount = open.data?.length ?? 0;

  return (
    <>
      <OperatorPicker />
      <AppShell header={{ height: 64 }} footer={{ height: 48 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
            {NAV.filter((item) => item.to === '/checkout' || item.to === '/checkin').map(
              (item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  variant={pathname === item.to ? 'light' : 'subtle'}
                  size="lg"
                  px="md"
                  rightSection={
                    item.to === '/checkin' && openCount > 0 ? (
                      <Badge size="lg" circle color="teal">
                        {openCount}
                      </Badge>
                    ) : undefined
                  }
                >
                  {t(item.key)}
                </Button>
              ),
            )}
          </Group>
          <Text fw={600} size="lg">{clock}</Text>
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, justifyContent: 'flex-end' }}>
            {NAV.filter((item) => item.to !== '/checkout' && item.to !== '/checkin').map(
              (item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  variant={pathname === item.to ? 'light' : 'subtle'}
                  size="lg"
                  px="md"
>
                  {t(item.key)}
                </Button>
              ),
            )}
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
            <Tooltip label={t('change_operator')}>
              <Badge
                color={operator ? 'blue' : 'gray'}
                variant="light"
                style={{ cursor: 'pointer' }}
                onClick={() => setOperator(null)}
              >
                {operator?.name ?? t('no_operator')}
              </Badge>
            </Tooltip>
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
            <Text size="sm" c="dimmed">
              {t('backup_last')}:{' '}
              {(() => {
                const latest = backups.data?.find((b) => b.source === 'remote');
                if (!latest) return '–';
                const ts = latest.timestamp.slice(0, 16).replace('T', ' ');
                const today = new Date().toISOString().slice(0, 10);
                return latest.timestamp.startsWith(today) ? ts.slice(11) : ts.slice(0, 10);
              })()}
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
            <Tooltip label={fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
                onClick={() => setFullscreen(!fullscreen)}
              >
                {fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
              </ActionIcon>
            </Tooltip>
            {isAdmin && (
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={t('nav_settings')}
                onClick={() => navigate('/settings')}
              >
                ⚙
              </ActionIcon>
            )}
          </Group>
        </Group>
      </AppShell.Footer>
      </AppShell>
    </>
  );
}
