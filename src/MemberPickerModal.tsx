import {
  Modal,
  Grid,
  Stack,
  ScrollArea,
  Card,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listUsers } from './api';
import { userLabel } from './labels';
import { Numpad } from './Numpad';

// Touch-first member selector: box list left, tag numpad + name search right.
// Active members only (same pool as the old dropdown).
export function MemberPickerModal({
  opened,
  onClose,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  onSelect: (uid: number) => void;
}) {
  const { t } = useTranslation();
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (opened) {
      setTag('');
      setText('');
    }
  }, [opened]);

  const users = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: opened });
  const pool = (users.data ?? []).filter((u) => u.active);

  const q = text.trim().toLowerCase();
  const filtered = pool.filter((u) => {
    if (tag && !(u.displayId ?? '').startsWith(tag)) return false;
    if (q && !u.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  return (
    <Modal opened={opened} onClose={onClose} title={t('pick_member')} size="xl" centered>
      <Grid gap="md">
        <Grid.Col span={7}>
          <ScrollArea h={420} type="auto">
            <Stack gap="xs">
              {sorted.length === 0 && <Text c="dimmed">{t('no_results')}</Text>}
              {sorted.map((u) => (
                <Card
                  key={u.uid}
                  withBorder
                  padding="sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(u.uid)}
                >
                  <Stack gap={2}>
                    <Text fw={600}>{userLabel(u.name, u.displayId, true, t)}</Text>
                    {u.phone && (
                      <Text size="xs" c="dimmed">
                        {u.phone}
                      </Text>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={5}>
          <Stack gap="xs">
            <Numpad value={tag} onChange={setTag} size="md" />
            <TextInput
              placeholder={t('filter_name')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
