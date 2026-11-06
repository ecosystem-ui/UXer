import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Stack,
  Alert,
} from '@mui/material';
import { api } from '../api/client';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Missing or invalid reset link.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
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
      bgcolor="background.default"
    >
      <Card sx={{ width: 400 }} elevation={2}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
            UXer
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Choose a new password.
          </Typography>

          {done ? (
            <Stack spacing={2}>
              <Alert severity="success">Your password has been reset.</Alert>
              <Button component={Link} to="/login" variant="contained" fullWidth>
                Sign in
              </Button>
            </Stack>
          ) : (
            <>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                  {error}
                </Alert>
              )}
              <Stack spacing={2}>
                <TextField
                  label="New password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  autoComplete="new-password"
                />
                <TextField
                  label="Confirm new password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  fullWidth
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
                <Button variant="contained" size="large" onClick={submit} disabled={busy} fullWidth>
                  Reset password
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}