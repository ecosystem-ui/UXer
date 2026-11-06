import { useState } from 'react';
import { Navigate } from 'react-router-dom';
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
import { useThemeMode } from '../theme/ThemeModeContext';
import { api } from '../api/client';

type AuthMode = 'login' | 'signup' | 'forgot';

export default function LoginPage() {
  const { user, loading, login, signup } = useAuth();
  const { mode: themeMode, toggle } = useThemeMode();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

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
      setError('Email is required.');
      return;
    }
    if (mode !== 'forgot' && !password) {
      setError('Email and password are required.');
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
        setNotice('If an account exists for that email, a reset link has been sent.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const subtitle =
    mode === 'login'
      ? 'Sign in to manage your design reviews.'
      : mode === 'signup'
        ? 'Create an account to get started.'
        : 'Enter your email and we will send you a reset link.';

  const submitLabel = mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Send reset link';

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="background.default"
      sx={{ position: 'relative' }}
    >
      <Tooltip title={themeMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        <IconButton
          onClick={toggle}
          aria-label="Toggle color theme"
          sx={{ position: 'absolute', top: 16, right: 16 }}
        >
          {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tooltip>
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
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                autoComplete="name"
              />
            )}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              autoComplete="email"
            />
            {mode !== 'forgot' && (
              <TextField
                label="Password"
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
                Forgot password?
              </Button>
            )}
            {mode === 'forgot' && (
              <Button size="small" onClick={() => switchMode('login')}>
                Back to sign in
              </Button>
            )}
            {mode !== 'forgot' && (
              <Typography variant="body2" color="text.secondary">
                {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                <Typography
                  component="span"
                  variant="body2"
                  color="primary.main"
                  sx={{ cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                >
                  {mode === 'login' ? 'Sign up' : 'Sign in'}
                </Typography>
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
