import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card, Group, ScrollArea, SegmentedControl, Stack, Table, Text, Title, ActionIcon, Button,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import dayjs from 'dayjs';
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

function periodOf(preset: Preset): { from: string | null; to: string | null; bucket: Bucket } {
  const now = dayjs();
  switch (preset) {
    case 'today':
      return { from: now.startOf('day').toISOString(), to: null, bucket: 'hour' };
    case 'week':
      return { from: now.startOf('isoWeek').toISOString(), to: null, bucket: 'day' };
    case 'month':
      return { from: now.startOf('month').toISOString(), to: null, bucket: 'day' };
    case 'year':
      return { from: now.startOf('year').toISOString(), to: null, bucket: 'month' };
    case 'all':
      return { from: null, to: null, bucket: 'year' };
  }
}

function fillBuckets(preset: Preset, rows: LoanBucket[]): { label: string; count: number }[] {
  const m = new Map(rows.map((r) => [r.bucket, r.count]));
  const now = dayjs();
  const out: { label: string; count: number }[] = [];
  if (preset === 'today') {
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0');
      out.push({ label: key, count: m.get(key) ?? 0 });
    }
  } else if (preset === 'week' || preset === 'month') {
    let d = preset === 'week' ? now.startOf('isoWeek') : now.startOf('month');
    while (d.isBefore(now, 'day') || d.isSame(now, 'day')) {
      out.push({
        label:
          preset === 'week'
            ? d.toDate().toLocaleDateString(LOCALE, { weekday: 'short' })
            : String(d.date()),
        count: m.get(d.format('YYYY-MM-DD')) ?? 0,
      });
      d = d.add(1, 'day');
    }
  } else if (preset === 'year') {
    for (let mo = 0; mo < 12; mo++) {
      const d = now.startOf('year').add(mo, 'month');
      out.push({
        label: d.toDate().toLocaleDateString(LOCALE, { month: 'short' }),
        count: m.get(d.format('YYYY-MM')) ?? 0,
      });
    }
  } else {
    const years = rows.map((r) => Number(r.bucket)).filter((y) => !Number.isNaN(y));
    const start = years.length ? Math.min(...years) : now.year();
    for (let y = start; y <= now.year(); y++) {
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
  const { from, to, bucket } = periodOf(preset);
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
          <SegmentedControl
            size="lg"
            value={preset}
            onChange={(v) => setPreset(v as Preset)}
            data={[
              { value: 'today', label: t('stats_period_today') },
              { value: 'week', label: t('stats_period_week') },
              { value: 'month', label: t('stats_period_month') },
              { value: 'year', label: t('stats_period_year') },
              { value: 'all', label: t('stats_period_all') },
            ]}
          />
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
          <Bars data={fillBuckets(preset, buckets.data ?? [])} />
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
