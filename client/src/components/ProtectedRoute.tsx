import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import { loginPathFor } from '../auth/redirect';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPathFor(from)} replace />;
  }
  return <Outlet />;
}
