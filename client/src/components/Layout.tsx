import { useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../auth/AuthContext';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      <AppBar position="static" elevation={0} color="default" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar>
          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ flexGrow: 1, cursor: 'pointer', color: 'primary.main' }}
            onClick={() => navigate('/')}
          >
            UXer
          </Typography>
          {user && (
            <>
              <Tooltip title={user.name || user.login}>
                <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
                  <Avatar src={user.avatar_url} alt={user.login} sx={{ width: 34, height: 34 }}>
                    {(user.login || '?').charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                <MenuItem disabled sx={{ opacity: 1 }}>
                  <Typography variant="body2" color="text.primary" fontWeight={500}>
                    {user.name || user.login}
                  </Typography>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setAnchor(null);
                    logout();
                  }}
                >
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  Log out
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>
      {children}
    </>
  );
}
