import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Stack,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useAuth } from '../auth/AuthContext';
import { resolveNextPath } from '../auth/redirect';
import { useThemeMode } from '../theme/ThemeModeContext';
import { api } from '../api/client';
import LanguageToggle from '../components/LanguageToggle';

type AuthMode = 'login' | 'signup' | 'forgot';

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, loading, login, signup } = useAuth();
  const [searchParams] = useSearchParams();
  const next = resolveNextPath(searchParams.get('next'));
  const { mode: themeMode, toggle } = useThemeMode();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={next} replace />;

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
  };

  const submit = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError(t('auth.emailRequired'));
      return;
    }
    if (mode !== 'forgot' && !password) {
      setError(t('auth.emailAndPasswordRequired'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signup(email.trim(), password, name.trim() || undefined);
      } else if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await api.forgotPassword(email.trim());
        setNotice(t('auth.forgotNotice'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  };

  const subtitle =
    mode === 'login'
      ? t('auth.loginSubtitle')
      : mode === 'signup'
        ? t('auth.signupSubtitle')
        : t('auth.forgotSubtitle');

  const submitLabel =
    mode === 'login'
      ? t('auth.signIn')
      : mode === 'signup'
        ? t('auth.signUp')
        : t('auth.sendResetLink');

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="background.default"
      sx={{ position: 'relative' }}
    >
      <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 1 }}>
        <LanguageToggle />
        <Tooltip
          title={themeMode === 'dark' ? t('layout.switchToLight') : t('layout.switchToDark')}
        >
          <IconButton onClick={toggle} aria-label={t('layout.toggleColorTheme')}>
            {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Tooltip>
      </Box>
      <Card sx={{ width: 400 }} elevation={2}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
            UXer
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            {subtitle}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}

          <Stack spacing={2}>
            {mode === 'signup' && (
              <TextField
                label={t('auth.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                autoComplete="name"
              />
            )}
            <TextField
              label={t('auth.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              autoComplete="email"
            />
            {mode !== 'forgot' && (
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            )}
            <Button variant="contained" size="large" onClick={submit} disabled={busy} fullWidth>
              {submitLabel}
            </Button>
          </Stack>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            {mode === 'login' && (
              <Button size="small" onClick={() => switchMode('forgot')}>
                {t('auth.forgotPassword')}
              </Button>
            )}
            {mode === 'forgot' && (
              <Button size="small" onClick={() => switchMode('login')}>
                {t('auth.backToSignIn')}
              </Button>
            )}
            {mode !== 'forgot' && (
              <Typography variant="body2" color="text.secondary">
                {mode === 'login' ? t('auth.dontHaveAccount') : t('auth.alreadyHaveAccount')}
                <Typography
                  component="span"
                  variant="body2"
                  color="primary.main"
                  sx={{ cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                >
                  {mode === 'login' ? t('auth.signUp') : t('auth.signIn')}
                </Typography>
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
