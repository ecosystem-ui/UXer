import { createTheme, type Theme } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

/**
 * Design tokens ported from the reference review-panel design system.
 * Original values are defined in oklch; converted here to hex for MUI.
 */
export interface Tokens {
  foreground: string;
  canvas: string;
  surface: string;
  surfaceBorder: string;
  muted: string;
  mutedForeground: string;
  border: string;
  open: string;
  openSoft: string;
  resolved: string;
  resolvedSoft: string;
  ink: string; // primary: dark slate, used for avatars and primary actions
}

export const lightTokens: Tokens = {
  foreground: '#101817',
  canvas: '#f5f7f6',
  surface: '#ffffff',
  surfaceBorder: '#dfe4e2',
  muted: '#edf3f1',
  mutedForeground: '#737b79',
  border: '#d8dddb',
  open: '#c35b0b',
  openSoft: '#fff0e5',
  resolved: '#2f8c4d',
  resolvedSoft: '#e1f3e6',
  ink: '#0d7f78',
};

export const darkTokens: Tokens = {
  foreground: '#f1f5f9',
  canvas: '#0b1714',
  surface: '#10211c',
  surfaceBorder: '#244137',
  muted: '#193029',
  mutedForeground: '#9ab5aa',
  border: '#2f4a40',
  open: '#79d6c6',
  openSoft: '#20343b',
  resolved: '#34d399',
  resolvedSoft: '#064e3b',
  ink: '#0d7f78',
};

export const tokensFor = (mode: ColorMode): Tokens => (mode === 'dark' ? darkTokens : lightTokens);

export function createAppTheme(mode: ColorMode): Theme {
  const t = tokensFor(mode);
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: dark
        ? { main: '#79d6c6', contrastText: '#0b1220' }
        : { main: t.ink, contrastText: '#ffffff' },
      secondary: { main: t.mutedForeground },
      success: { main: dark ? '#34d399' : t.resolved },
      error: { main: dark ? '#ef4444' : '#e7000b' },
      background: dark
        ? { default: t.canvas, paper: '#111827' }
        : { default: t.canvas, paper: '#ffffff' },
      divider: t.border,
      text: { primary: t.foreground, secondary: t.mutedForeground },
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
}
