import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { createAppTheme, tokensFor, type ColorMode, type Tokens } from '../theme';

const STORAGE_KEY = 'uxer.colorMode';

interface ThemeModeValue {
  mode: ColorMode;
  tokens: Tokens;
  toggle: () => void;
}

const ThemeModeContext = createContext<ThemeModeValue>({
  mode: 'light',
  tokens: tokensFor('light'),
  toggle: () => {},
});

function initialMode(): ColorMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore storage errors (e.g. privacy mode)
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(initialMode);

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const tokens = useMemo(() => tokensFor(mode), [mode]);

  const toggle = () =>
    setMode((prev) => {
      const next: ColorMode = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });

  const value = useMemo(() => ({ mode, tokens, toggle }), [mode, tokens]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeValue {
  return useContext(ThemeModeContext);
}
