import { Navigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, loading, login } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="grey.100"
    >
      <Card sx={{ width: 380, textAlign: 'center' }} elevation={2}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" fontWeight={700} color="primary.main" gutterBottom>
            UXer
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Manage design reviews across versions. Sign in to continue.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<GitHubIcon />}
            onClick={login}
            fullWidth
          >
            Sign in with GitHub
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
