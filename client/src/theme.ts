import { createTheme } from '@mui/material/styles';

/**
 * Design tokens ported from the reference review-panel design system.
 * Original values are defined in oklch; converted here to hex for MUI.
 */
export const tokens = {
  foreground: '#020618',
  canvas: '#eef0f3',
  muted: '#f1f5f9',
  mutedForeground: '#62748e',
  border: '#e2e8f0',
  open: '#1570d1',
  openSoft: '#e1f0ff',
  resolved: '#14874e',
  resolvedSoft: '#daf7e3',
  ink: '#0f172b', // primary: dark slate, used for avatars and primary actions
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0f172b', contrastText: '#f8fafc' },
    secondary: { main: '#62748e' },
    error: { main: '#e7000b' },
    background: { default: '#ffffff', paper: '#ffffff' },
    divider: '#e2e8f0',
    text: { primary: '#020618', secondary: '#62748e' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: ['IBM Plex Sans', 'Inter', '-apple-system', 'Segoe UI', 'sans-serif'].join(','),
    subtitle1: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
  },
});
