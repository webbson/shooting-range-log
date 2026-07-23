import '@mantine/core/styles.css';
// ‼️ notifications styles must be imported after core styles
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import './global.css';
import 'dayjs/locale/sv';

import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import './i18n';
import { theme } from './theme';
import { AppLayout } from './AppLayout';
import { CheckoutPage } from './CheckoutPage';
import { CheckinPage } from './CheckinPage';
import { MembersPage } from './MembersPage';
import { WeaponsPage } from './WeaponsPage';
import { LogsPage } from './LogsPage';
import { SettingsPage } from './SettingsPage';
import { StatsPage } from './StatsPage';
import { MaintenancePage } from './MaintenancePage';
import { UpdatePrompt } from './UpdatePrompt';

// Tauri invoke is IPC, not HTTP — never pause queries/mutations on
// navigator.onLine (default networkMode 'online' froze refetches when the
// WebView thought it was offline, leaving the open-checkouts list stale).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

// Remounts CheckoutPage on every navigation (react-router bumps the location
// key on each nav), so clicking the header "Utlämning" button always resets
// the flow to the selector step, even when already on /checkout.
function CheckoutRoute() {
  return <CheckoutPage key={useLocation().key} />;
}

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="light" />
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" />
        <UpdatePrompt />
        <DatesProvider settings={{ locale: 'sv', firstDayOfWeek: 1 }}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/checkout" replace />} />
                <Route path="checkout" element={<CheckoutRoute />} />
                <Route path="checkin" element={<CheckinPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="weapons" element={<WeaponsPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="maintenance" element={<MaintenancePage />} />
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
