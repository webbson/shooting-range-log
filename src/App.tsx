import '@mantine/core/styles.css';
// ‼️ notifications styles must be imported after core styles
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import 'dayjs/locale/sv';

import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import './i18n';
import { theme } from './theme';
import { AppLayout } from './AppLayout';
import { CheckoutPage } from './CheckoutPage';
import { MembersPage } from './MembersPage';
import { MemberDetailPage } from './MemberDetailPage';
import { WeaponsPage } from './WeaponsPage';
import { LogsPage } from './LogsPage';
import { SettingsPage } from './SettingsPage';

// Tauri invoke is IPC, not HTTP — never pause queries/mutations on
// navigator.onLine (default networkMode 'online' froze refetches when the
// WebView thought it was offline, leaving the open-checkouts list stale).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="light" />
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" />
        <DatesProvider settings={{ locale: 'sv', firstDayOfWeek: 1 }}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/checkout" replace />} />
                <Route path="checkout" element={<CheckoutPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="members/:uid" element={<MemberDetailPage />} />
                <Route path="weapons" element={<WeaponsPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="backup" element={<Navigate to="/settings" replace />} />
              </Route>
            </Routes>
            </BrowserRouter>
          </QueryClientProvider>
        </DatesProvider>
      </MantineProvider>
    </>
  );
}
