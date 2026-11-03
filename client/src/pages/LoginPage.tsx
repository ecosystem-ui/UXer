import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Typography, TextField, Stack, Alert } from '@mui/material';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, loading, login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const submit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signup(email.trim(), password, name.trim() || undefined);
      } else {
        await login(email.trim(), password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="grey.100"
    >
      <Card sx={{ width: 400 }} elevation={2}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
            UXer
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            {mode === 'login'
              ? 'Sign in to manage your design reviews.'
              : 'Create an account to get started.'}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
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
            <Button variant="contained" size="large" onClick={submit} disabled={busy} fullWidth>
              {mode === 'login' ? 'Sign in' : 'Sign up'}
            </Button>
          </Stack>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <Typography
                component="span"
                variant="body2"
                color="primary.main"
                sx={{ cursor: 'pointer', fontWeight: 600 }}
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                }}
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </Typography>
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
