import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import {
  AppShell,
  Group,
  Button,
  Text,
  Badge,
  Tooltip,
  SegmentedControl,
  ActionIcon,
  Modal,
  Stack,
  Drawer,
  Indicator,
  Divider,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
  IconBook,
  IconDownload,
  IconMaximize,
  IconMenu2,
  IconMinimize,
  IconPower,
} from '@tabler/icons-react';
import { useAppStore, type Lang } from './store';
import { dbHealth, listBackups, listOpenCheckouts } from './api';
import { OperatorPicker } from './OperatorPicker';
import { errorMessage } from './errors';
import { useIsAdmin } from './useIsAdmin';
import { useScanner } from './useScanner.ts';

// Header: the four daily-use buttons. Drawer: everything else.
const HEADER_NAV = [
  { to: '/checkout', key: 'nav_checkout' },
  { to: '/checkin', key: 'nav_checkin' },
  { to: '/members', key: 'nav_members' },
  { to: '/weapons', key: 'nav_weapons' },
] as const;

const DRAWER_NAV = [
  { to: '/logs', key: 'nav_logs' },
  { to: '/stats', key: 'nav_stats' },
  { to: '/maintenance', key: 'nav_maintenance' },
] as const;

const BACKUP_OVERDUE_MS = 2 * 60 * 60 * 1000; // snapshots run hourly

export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const operator = useAppStore((s) => s.operator);
  const setOperator = useAppStore((s) => s.setOperator);
  const isAdmin = useIsAdmin();
  const update = useAppStore((s) => s.update);
  const setUpdateOpen = useAppStore((s) => s.setUpdateOpen);
  useScanner();
  const fullscreen = useAppStore((s) => s.fullscreen);
  const setFullscreen = useAppStore((s) => s.setFullscreen);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [drawerOpened, { close: closeDrawer, toggle: toggleDrawer }] = useDisclosure(false);

  // Applies the toggle and, on mount, restores the persisted mode from launch.
  useEffect(() => {
    getCurrentWindow().setFullscreen(fullscreen).catch(console.warn);
  }, [fullscreen]);

  // The guide PDFs ship as bundled resources (tauri.conf.json), so the range
  // laptop opens them with no internet. Rust does the opening (open_user_guide)
  // — the plugin's JS path is ACL-scoped and failed silently on Windows.
  const openGuide = () => {
    invoke('open_user_guide', { lang: language }).catch((e) => {
      console.warn('[guide]', e);
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    });
  };

  const { toggleColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');

  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('sv-SE'));
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString('sv-SE')), 1000);
    return () => clearInterval(id);
  }, []);

  // Idle logout: no pointer/key activity for operatorIdleMinutes clears the
  // operator, so the picker reappears. Deps stay coarse (`!!operator`) — the
  // clock re-renders once a second and would otherwise re-arm forever.
  const operatorIdleMinutes = useAppStore((s) => s.operatorIdleMinutes);
  const hasOperator = !!operator;
  useEffect(() => {
    if (!hasOperator) return;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setOperator(null), operatorIdleMinutes * 60_000);
    };
    arm();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [hasOperator, operatorIdleMinutes, setOperator]);

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

  // Status is silent in the normal case — only surfaced when something is
  // actually wrong. An empty/loading backup list (fresh install, first
  // fetch) is not a fault, so it stays silent rather than reading "overdue".
  const newestBackupMs = useMemo(() => {
    if (!backups.data || backups.data.length === 0) return null;
    return Math.max(...backups.data.map((b) => new Date(b.timestamp).getTime()));
  }, [backups.data]);
  const backupOverdue = newestBackupMs !== null && Date.now() - newestBackupMs > BACKUP_OVERDUE_MS;
  const hasIssue = health.isError || backupOverdue;

  // Background image (workstream E). staleTime: Infinity — the native file
  // dialog (Settings' image picker) steals and returns window focus, which
  // would otherwise refetch this multi-MB payload via refetchOnWindowFocus;
  // set/clear mutations invalidate this key explicitly instead. Queried here
  // (not in SettingsPage) so the layer persists across route changes.
  const backgroundEnabled = useAppStore((s) => s.backgroundEnabled);
  const backgroundPosition = useAppStore((s) => s.backgroundPosition);
  const backgroundSize = useAppStore((s) => s.backgroundSize);
  const backgroundOpacity = useAppStore((s) => s.backgroundOpacity);
  const backgroundMargin = useAppStore((s) => s.backgroundMargin);
  const surfaceOpacity = useAppStore((s) => s.surfaceOpacity);
  const background = useQuery({
    queryKey: ['background'],
    queryFn: () => invoke<string | null>('get_background'),
    staleTime: Infinity,
  });
  // Memoized so the clock's 1x/second re-render doesn't rebuild a fresh
  // multi-MB `url(...)` string (and a full-length React style diff) every
  // tick — only recomputes when the image or a display setting changes.
  const imageData = background.data;
  const backgroundStyle = useMemo<CSSProperties | undefined>(
    () =>
      imageData
        ? {
            position: 'fixed',
            inset: backgroundMargin,
            zIndex: -1,
            pointerEvents: 'none',
            backgroundImage: `url("${imageData}")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition,
            backgroundSize,
            opacity: backgroundOpacity,
          }
        : undefined,
    [imageData, backgroundPosition, backgroundSize, backgroundOpacity, backgroundMargin],
  );

  // Surface (Paper/Card) translucency (workstream E2): a CSS custom property
  // read by the `.mantine-AppShell-main .mantine-Paper-root` rule in
  // global.css. Set on AppShell.Main (not :root) so it's scoped to page
  // content — Mantine renders modals/popovers/dropdowns as Paper too, via a
  // portal at body level, outside this element, so they stay solid.
  const surfaceStyle = { '--surface-opacity': surfaceOpacity } as CSSProperties;

  return (
    <>
      {backgroundEnabled && backgroundStyle && <div aria-hidden style={backgroundStyle} />}
      <OperatorPicker />
      <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
            {HEADER_NAV.filter((item) => item.to === '/checkout' || item.to === '/checkin').map(
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
            {HEADER_NAV.filter((item) => item.to !== '/checkout' && item.to !== '/checkin').map(
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
            <Indicator
              color={hasIssue ? 'red' : 'blue'}
              size={10}
              offset={4}
              disabled={!hasIssue && !update}
            >
              <Button
                variant="outline"
                color={operator ? 'blue' : 'gray'}
                size="lg"
                px="md"
                maw={220}
                aria-label={t('menu')}
                onClick={toggleDrawer}
                leftSection={<IconMenu2 size={20} />}
                styles={{ label: { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              >
                {operator?.name ?? t('no_operator')}
              </Button>
            </Indicator>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main style={surfaceStyle}>
        <Outlet />
      </AppShell.Main>
      </AppShell>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        position="right"
        size="sm"
        title={t('menu')}
        padding="md"
      >
        <Stack gap="xs">
          {DRAWER_NAV.map((item) => (
            <Button
              key={item.to}
              component={NavLink}
              to={item.to}
              variant={pathname === item.to ? 'light' : 'subtle'}
              size="lg"
              justify="flex-start"
              fullWidth
              onClick={closeDrawer}
            >
              {t(item.key)}
            </Button>
          ))}

          <Divider />

          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {t('operator')}
            </Text>
            <Tooltip label={t('change_operator')}>
              <Badge
                size="lg"
                color={operator ? 'blue' : 'gray'}
                variant="light"
                style={{ cursor: 'pointer' }}
                onClick={() => setOperator(null)}
              >
                {operator?.name ?? t('no_operator')}
              </Badge>
            </Tooltip>
          </Group>

          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {t('language')}
            </Text>
            <SegmentedControl
              size="sm"
              value={language}
              onChange={(v) => setLanguage(v as Lang)}
              data={[
                { label: 'SV', value: 'sv' },
                { label: 'EN', value: 'en' },
              ]}
            />
          </Group>

          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {t('theme')}
            </Text>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={t('theme')}
              onClick={toggleColorScheme}
            >
              {computed === 'dark' ? '☀' : '🌙'}
            </ActionIcon>
          </Group>

          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
            </Text>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
            </ActionIcon>
          </Group>

          {update && (
            <Button
              variant="light"
              color="blue"
              size="lg"
              justify="flex-start"
              fullWidth
              leftSection={<IconDownload size={18} />}
              onClick={() => {
                setUpdateOpen(true);
                closeDrawer();
              }}
            >
              {t('update_available', { version: update.version })}
            </Button>
          )}

          <Button
            variant="subtle"
            size="lg"
            justify="flex-start"
            fullWidth
            leftSection={<IconBook size={18} />}
            onClick={() => {
              openGuide();
              closeDrawer();
            }}
          >
            {t('user_guide')}
          </Button>

          {isAdmin && (
            <Button
              variant="subtle"
              size="lg"
              justify="flex-start"
              fullWidth
              onClick={() => {
                navigate('/settings');
                closeDrawer();
              }}
            >
              {t('nav_settings')}
            </Button>
          )}

          {/* Only rule off the tail when something actually follows it: the
              status lines appear solely on a fault, and shutdown solely in
              fullscreen, so windowed-and-healthy would otherwise end the
              drawer with a divider under nothing. */}
          {(hasIssue || fullscreen) && <Divider />}

          {health.isError && (
            <Text size="sm" c="red">
              {t('db_status')}: {t('db_error')}
            </Text>
          )}
          {backupOverdue && (
            <Text size="sm" c="red">
              {t('status_backup_overdue')}
            </Text>
          )}

          {/* Fullscreen hides the window's own close button — this is the only
              way out of the app while in that mode. */}
          {fullscreen && (
            <Button
              variant="light"
              color="red"
              size="lg"
              justify="flex-start"
              fullWidth
              leftSection={<IconPower size={18} />}
              onClick={() => setConfirmShutdown(true)}
            >
              {t('shutdown')}
            </Button>
          )}
        </Stack>
      </Drawer>

      <Modal
        opened={confirmShutdown}
        onClose={() => setConfirmShutdown(false)}
        title={t('shutdown')}
        centered
      >
        <Stack>
          <Text fz="lg">{t('shutdown_confirm')}</Text>
          <Text fz="lg" fw={600}>
            {t('are_you_sure')}
          </Text>
          <Group grow>
            <Button size="lg" variant="default" onClick={() => setConfirmShutdown(false)}>
              {t('no')}
            </Button>
            <Button
              size="lg"
              color="red"
              // close() (not destroy()) so the backup snapshot on ExitRequested runs.
              onClick={() => getCurrentWindow().close()}
            >
              {t('yes')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
