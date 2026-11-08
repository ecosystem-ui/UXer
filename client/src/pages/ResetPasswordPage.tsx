import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Typography, TextField, Stack, Alert } from '@mui/material';
import { api } from '../api/client';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
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
      setError(t('reset.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('reset.passwordsDoNotMatch'));
      return;
    }
    if (!token) {
      setError(t('reset.missingToken'));
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.somethingWentWrong'));
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
            {t('reset.subtitle')}
          </Typography>

          {done ? (
            <Stack spacing={2}>
              <Alert severity="success">{t('reset.success')}</Alert>
              <Button component={Link} to="/login" variant="contained" fullWidth>
                {t('auth.signIn')}
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
                  label={t('reset.newPassword')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  autoComplete="new-password"
                />
                <TextField
                  label={t('reset.confirmNewPassword')}
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
                  {t('reset.resetPassword')}
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
