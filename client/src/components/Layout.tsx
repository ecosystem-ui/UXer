import { useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
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
import LanguageToggle from './LanguageToggle';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../theme/ThemeModeContext';

export default function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { mode, toggle, tokens } = useThemeMode();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      <AppBar
        position="static"
        elevation={0}
        color="default"
        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Toolbar sx={{ minHeight: { xs: 60, md: 82 }, px: { xs: 2, md: 3 } }}>
          <Box sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate('/')}>
            <Typography variant="h4" fontWeight={900} sx={{ color: 'primary.main' }}>
              <span style={{ color: tokens.foreground }}>UX</span>er
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('app.tagline')}
            </Typography>
          </Box>
          <LanguageToggle />
          <Tooltip title={mode === 'dark' ? t('layout.switchToLight') : t('layout.switchToDark')}>
            <IconButton onClick={toggle} aria-label={t('layout.toggleColorTheme')}>
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
                  {t('layout.logOut')}
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
