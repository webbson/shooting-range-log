import '@mantine/core/styles.css';
// ‼️ notifications styles must be imported after core styles
import '@mantine/notifications/styles.css';

import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import './i18n';
import { theme } from './theme';
import { AppLayout } from './AppLayout';
import { Placeholder } from './pages';
import { CheckoutPage } from './CheckoutPage';
import { MembersPage } from './MembersPage';
import { WeaponsPage } from './WeaponsPage';

const queryClient = new QueryClient();

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="light" />
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-right" />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/checkout" replace />} />
                <Route path="checkout" element={<CheckoutPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="weapons" element={<WeaponsPage />} />
                <Route path="logs" element={<Placeholder titleKey="nav_logs" />} />
                <Route path="backup" element={<Placeholder titleKey="nav_backup" />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </MantineProvider>
    </>
  );
}
