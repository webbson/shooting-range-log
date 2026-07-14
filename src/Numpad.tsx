import { SimpleGrid, Button, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Touch-first numeric keypad + readonly value display. Shared by the fast
// check-in modal (xl) and the picker modals (md). Keyboard entry stays the
// parent's job (it owns the value).
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

export function Numpad({
  value,
  onChange,
  size = 'xl',
}: {
  value: string;
  onChange: (v: string) => void;
  size?: 'md' | 'xl';
}) {
  const { t } = useTranslation();
  const press = (k: string) => {
    if (k === 'C') onChange('');
    else if (k === '⌫') onChange(value.slice(0, -1));
    else onChange(value + k);
  };
  return (
    <>
      <TextInput
        value={value}
        readOnly
        placeholder={t('enter_id')}
        size={size}
        styles={{
          input: {
            textAlign: 'center',
            fontSize: size === 'xl' ? '2rem' : '1.4rem',
            fontVariantNumeric: 'tabular-nums',
          },
        }}
      />
      <SimpleGrid cols={3} spacing="xs">
        {KEYS.map((k) => (
          <Button key={k} variant="default" size={size} onClick={() => press(k)}>
            {k}
          </Button>
        ))}
      </SimpleGrid>
    </>
  );
}
