import { createTheme, type Theme } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

/**
 * Design tokens ported from the reference review-panel design system.
 * Original values are defined in oklch; converted here to hex for MUI.
 */
export interface Tokens {
  foreground: string;
  canvas: string;
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
  foreground: '#020618',
  canvas: '#eef0f3',
  muted: '#f1f5f9',
  mutedForeground: '#62748e',
  border: '#e2e8f0',
  open: '#1570d1',
  openSoft: '#e1f0ff',
  resolved: '#14874e',
  resolvedSoft: '#daf7e3',
  ink: '#0f172b',
};

export const darkTokens: Tokens = {
  foreground: '#f1f5f9',
  canvas: '#0b1220',
  muted: '#1e293b',
  mutedForeground: '#94a3b8',
  border: '#334155',
  open: '#60a5fa',
  openSoft: '#1e3a8a',
  resolved: '#34d399',
  resolvedSoft: '#064e3b',
  ink: '#475569',
};

export const tokensFor = (mode: ColorMode): Tokens => (mode === 'dark' ? darkTokens : lightTokens);

export function createAppTheme(mode: ColorMode): Theme {
  const t = tokensFor(mode);
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: dark
        ? { main: '#e2e8f0', contrastText: '#0f172a' }
        : { main: t.ink, contrastText: '#f8fafc' },
      secondary: { main: t.mutedForeground },
      error: { main: dark ? '#ef4444' : '#e7000b' },
      background: dark
        ? { default: t.canvas, paper: '#111827' }
        : { default: '#ffffff', paper: '#ffffff' },
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
