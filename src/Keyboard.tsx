import { SimpleGrid, Button, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Touch-first on-screen keyboard for name search (no physical keyboard on the
// kiosk). Modeled on Numpad: dumb, readonly display on top, parent owns the
// value. Swedish QWERTY letter layout; tapped letters are appended lowercase.
const ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Å'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

export function Keyboard({
  value,
  onChange,
  placeholder,
  withDisplay = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  // false when the parent already renders an input bound to the same value.
  withDisplay?: boolean;
}) {
  const { t } = useTranslation();
  const press = (k: string) => {
    if (k === '⌫') onChange(value.slice(0, -1));
    else onChange(value + k.toLowerCase());
  };
  return (
    <>
      {withDisplay && (
        <TextInput
          value={value}
          readOnly
          placeholder={placeholder ?? t('filter_name')}
          styles={{ input: { textAlign: 'center', fontSize: '1.4rem' } }}
        />
      )}
      {ROWS.map((row, i) => (
        <SimpleGrid key={i} cols={11} spacing={4}>
          {row.map((k) => (
            <Button
              key={k}
              variant="default"
              size="lg"
              px={0}
              onClick={() => press(k)}
              styles={{ label: { fontSize: '1.1rem' } }}
            >
              {k}
            </Button>
          ))}
        </SimpleGrid>
      ))}
      <SimpleGrid cols={2} spacing={4}>
        <Button variant="default" size="lg" onClick={() => press(' ')}>
          {' '}
        </Button>
        <Button variant="default" size="lg" onClick={() => press('⌫')}>
          ⌫
        </Button>
      </SimpleGrid>
    </>
  );
}
