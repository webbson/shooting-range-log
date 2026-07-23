import { createTheme } from '@mantine/core';

// Touch-first defaults: larger controls and base font for a touch-screen
// Windows laptop. Layout is designed at 1920x1080 first, scaling up.
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontSizes: {
    md: '1rem',
    lg: '1.125rem',
  },
  components: {
    Button: { defaultProps: { size: 'md' } },
    TextInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    DateInput: { defaultProps: { size: 'md' } },
    Switch: { defaultProps: { size: 'md' } },
  },
});
