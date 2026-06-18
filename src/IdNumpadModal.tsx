import { Modal, Stack, SimpleGrid, Button, TextInput, Text, Paper } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Touch-first number pad for entering an entity tag (display_id) at checkout — a
// fast alternative to the searchable dropdown. Resolution lives in the parent
// (it knows the available pools): `match` returns the matched entity's label (or
// richer ReactNode) for the current entry (or null), shown live; confirm is
// enabled only on a match.
export function IdNumpadModal({
  opened,
  title,
  match,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  match: (id: string) => React.ReactNode | null;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  // Start empty each time the modal opens.
  useEffect(() => {
    if (opened) setValue('');
  }, [opened]);

  const matched = value ? match(value) : null;

  const submit = () => {
    if (matched) onSubmit(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') setValue((v) => v + e.key);
    else if (e.key === 'Backspace') setValue((v) => v.slice(0, -1));
    else if (e.key === 'Enter') submit();
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  const press = (k: string) => {
    if (k === 'C') setValue('');
    else if (k === '⌫') setValue((v) => v.slice(0, -1));
    else setValue((v) => v + k);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="xs">
      <Stack onKeyDown={onKeyDown}>
        <TextInput
          value={value}
          readOnly
          placeholder={t('enter_id')}
          size="xl"
          styles={{ input: { textAlign: 'center', fontSize: '2rem', fontVariantNumeric: 'tabular-nums' } }}
        />
        <Paper withBorder p="xs" ta="center">
          {matched ? (
            <Text fw={600} c="teal">
              {matched}
            </Text>
          ) : (
            <Text c="dimmed">{value ? t('no_match') : ' '}</Text>
          )}
        </Paper>
        <SimpleGrid cols={3} spacing="xs">
          {keys.map((k) => (
            <Button
              key={k}
              variant="default"
              size="xl"
              onClick={() => press(k)}
            >
              {k}
            </Button>
          ))}
        </SimpleGrid>
        <Button size="lg" fullWidth disabled={!matched} onClick={submit}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </Stack>
    </Modal>
  );
}
