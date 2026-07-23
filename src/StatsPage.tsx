import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Card, Group, ScrollArea, SegmentedControl, Stack, Table, Text, Title, ActionIcon, Button,
} from '@mantine/core';
import { IconDownload, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  statsSummary, statsLoansBuckets, statsWeaponUsage, statsMemberActivity,
  outstandingDebts, listUsers, type Bucket, type LoanBucket,
} from './api';
import { useExportCsv } from './useExportCsv';
import { weaponLabel, userLabel } from './labels';

dayjs.extend(isoWeek);

type Preset = 'today' | 'week' | 'month' | 'year' | 'all';
const LOCALE = 'sv-SE';

function periodOf(
  preset: Preset,
  offset: number,
): { from: string | null; to: string | null; bucket: Bucket; start: Dayjs } {
  const now = dayjs();
  switch (preset) {
    case 'today': {
      const start = now.startOf('day').add(offset, 'day');
      return { from: start.toISOString(), to: start.add(1, 'day').toISOString(), bucket: 'hour', start };
    }
    case 'week': {
      const start = now.startOf('isoWeek').add(offset, 'week');
      return { from: start.toISOString(), to: start.add(1, 'week').toISOString(), bucket: 'day', start };
    }
    case 'month': {
      const start = now.startOf('month').add(offset, 'month');
      return { from: start.toISOString(), to: start.add(1, 'month').toISOString(), bucket: 'day', start };
    }
    case 'year': {
      const start = now.startOf('year').add(offset, 'year');
      return { from: start.toISOString(), to: start.add(1, 'year').toISOString(), bucket: 'month', start };
    }
    case 'all':
      return { from: null, to: null, bucket: 'year', start: now };
  }
}

function periodLabel(preset: Preset, start: Dayjs, t: TFunction): string {
  switch (preset) {
    case 'today':
      return start.format('YYYY-MM-DD');
    case 'week':
      return t('stats_week_label', { week: start.isoWeek(), year: start.isoWeekYear() });
    case 'month':
      return start.toDate().toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
    case 'year':
      return start.format('YYYY');
    case 'all':
      return '';
  }
}

function fillBuckets(preset: Preset, start: Dayjs, rows: LoanBucket[]): { label: string; count: number }[] {
  const m = new Map(rows.map((r) => [r.bucket, r.count]));
  const now = dayjs();
  const out: { label: string; count: number }[] = [];
  if (preset === 'today') {
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0');
      out.push({ label: key, count: m.get(key) ?? 0 });
    }
  } else if (preset === 'week') {
    for (let i = 0; i < 7; i++) {
      const d = start.add(i, 'day');
      out.push({
        label: d.toDate().toLocaleDateString(LOCALE, { weekday: 'short' }),
        count: m.get(d.format('YYYY-MM-DD')) ?? 0,
      });
    }
  } else if (preset === 'month') {
    for (let i = 0; i < start.daysInMonth(); i++) {
      const d = start.add(i, 'day');
      out.push({ label: String(d.date()), count: m.get(d.format('YYYY-MM-DD')) ?? 0 });
    }
  } else if (preset === 'year') {
    for (let mo = 0; mo < 12; mo++) {
      const d = start.add(mo, 'month');
      out.push({
        label: d.toDate().toLocaleDateString(LOCALE, { month: 'short' }),
        count: m.get(d.format('YYYY-MM')) ?? 0,
      });
    }
  } else {
    const years = rows.map((r) => Number(r.bucket)).filter((y) => !Number.isNaN(y));
    const startY = years.length ? Math.min(...years) : now.year();
    for (let y = startY; y <= now.year(); y++) {
      out.push({ label: String(y), count: m.get(String(y)) ?? 0 });
    }
  }
  return out;
}

function Bars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 210 }}>
      {data.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            height: '100%',
            minWidth: 0,
          }}
        >
          <Text size="xs">{d.count > 0 ? d.count : ''}</Text>
          <div
            style={{
              width: '100%',
              maxWidth: 48,
              height: `${Math.round((d.count / max) * 150)}px`,
              minHeight: d.count > 0 ? 4 : 0,
              background: 'var(--mantine-color-teal-6)',
              borderRadius: '4px 4px 0 0',
            }}
          />
          <Text size="xs" c="dimmed" truncate w="100%" ta="center">
            {d.label}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>('month');
  const [offset, setOffset] = useState(0);
  const { from, to, bucket, start } = periodOf(preset, offset);
  const doExport = useExportCsv();

  const summary = useQuery({
    queryKey: ['statsSummary', from, to],
    queryFn: () => statsSummary(from, to),
  });
  const buckets = useQuery({
    queryKey: ['statsBuckets', from, to, bucket],
    queryFn: () => statsLoansBuckets(from, to, bucket),
  });
  const usage = useQuery({
    queryKey: ['statsWeaponUsage', from, to],
    queryFn: () => statsWeaponUsage(from, to),
  });
  const activity = useQuery({
    queryKey: ['statsMemberActivity', from, to],
    queryFn: () => statsMemberActivity(from, to),
  });
  const debts = useQuery({ queryKey: ['outstandingDebts'], queryFn: outstandingDebts });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const userByUid = new Map((users.data ?? []).map((u) => [u.uid, u]));
  const stamp = dayjs().format('YYYY-MM-DD');

  const tiles: [string, number | undefined][] = [
    [t('stats_loans'), summary.data?.loanCount],
    [t('stats_members'), summary.data?.memberCount],
    [t('stats_guests'), summary.data?.guestCount],
  ];

  return (
    <ScrollArea h="calc(100vh - 144px)">
      <Stack gap="lg" pb="lg">
        <Group justify="space-between">
          <Group>
            <SegmentedControl
              size="lg"
              value={preset}
              onChange={(v) => {
                setPreset(v as Preset);
                setOffset(0);
              }}
              data={[
                { value: 'today', label: t('stats_period_today') },
                { value: 'week', label: t('stats_period_week') },
                { value: 'month', label: t('stats_period_month') },
                { value: 'year', label: t('stats_period_year') },
                { value: 'all', label: t('stats_period_all') },
              ]}
            />
            {preset !== 'all' && (
              <Group gap="xs">
                <ActionIcon size="xl" variant="light" onClick={() => setOffset((o) => o - 1)}>
                  <IconChevronLeft size={18} />
                </ActionIcon>
                <Text fw={500}>{periodLabel(preset, start, t)}</Text>
                <ActionIcon
                  size="xl"
                  variant="light"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => o + 1)}
                >
                  <IconChevronRight size={18} />
                </ActionIcon>
              </Group>
            )}
          </Group>
          <Button
            leftSection={<IconDownload size={18} />}
            variant="light"
            onClick={() => doExport('loans_raw', `lan-${preset}-${stamp}.csv`, { from, to })}
          >
            {t('export_loans_raw')}
          </Button>
        </Group>

        <Group grow>
          {tiles.map(([label, value]) => (
            <Card key={label} withBorder>
              <Text c="dimmed" size="sm">{label}</Text>
              <Text fz={40} fw={700}>{value ?? '–'}</Text>
            </Card>
          ))}
        </Group>

        <Card withBorder>
          <Bars data={fillBuckets(preset, start, buckets.data ?? [])} />
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_weapon_usage')}</Title>
            <ActionIcon
              size="xl"
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('weapon_usage', `vapenanvandning-${stamp}.csv`, { from, to })}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(usage.data ?? []).map((w) => (
                <Table.Tr key={w.weaponUid}>
                  <Table.Td>
                    {weaponLabel(w.brand, w.model, w.caliber, w.displayId, w.active, t)}
                  </Table.Td>
                  <Table.Td ta="right" w={100}>{w.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_member_activity')}</Title>
            <ActionIcon
              size="xl"
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('member_activity', `medlemsaktivitet-${stamp}.csv`, { from, to })}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(activity.data ?? []).map((m) => (
                <Table.Tr key={m.userUid}>
                  <Table.Td>{userLabel(m.name, m.active, t, m.isGuest)}</Table.Td>
                  <Table.Td ta="right" w={100}>{m.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t('stats_active_debts')}</Title>
            <ActionIcon
              size="xl"
              variant="light"
              aria-label={t('export_csv')}
              onClick={() => doExport('debts', `skulder-${stamp}.csv`)}
            >
              <IconDownload size={18} />
            </ActionIcon>
          </Group>
          <Table>
            <Table.Tbody>
              {(debts.data ?? []).map((d) => {
                const u = userByUid.get(d.userUid);
                return (
                  <Table.Tr key={d.userUid}>
                    <Table.Td>
                      {u ? userLabel(u.name, u.active, t, u.isGuest) : String(d.userUid)}
                    </Table.Td>
                    <Table.Td ta="right" w={140}>{d.amountKr} kr</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </ScrollArea>
  );
}
