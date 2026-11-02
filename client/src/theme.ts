import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' },
    secondary: { main: '#16a34a' },
    background: { default: '#fafafa' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: ['Roboto', '-apple-system', 'Segoe UI', 'sans-serif'].join(','),
  },
});
