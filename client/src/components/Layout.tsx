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
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../theme/ThemeModeContext';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
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
          <Tooltip title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <IconButton onClick={toggle} aria-label="Toggle color theme">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          {user && (
            <>
              <Tooltip title={user.name || user.email}>
                <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
                  <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main' }}>
                    {(user.name || user.email || '?').charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                <MenuItem disabled sx={{ opacity: 1 }}>
                  <Typography variant="body2" color="text.primary" fontWeight={500}>
                    {user.name || user.email}
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
