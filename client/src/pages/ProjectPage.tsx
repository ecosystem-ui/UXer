import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Button,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  SvgIcon,
  CircularProgress,
  Breadcrumbs,
  Link,
  Menu,
  MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Layout from '../components/Layout';
import ShareProjectDialog from '../components/ShareProjectDialog';
import { api } from '../api/client';
import type { Project, Version } from '../api/types';
import { useThemeMode } from '../theme/ThemeModeContext';

function PersonaLanguageIcon() {
  return (
    <SvgIcon className="persona-list__icon-shape" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient
          id="persona-icon-gradient"
          x1="0"
          y1="0"
          x2="0"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#f0c85b" />
          <stop offset="0.45" stopColor="#6ed6bd" />
          <stop offset="0.75" stopColor="#ef847d" />
          <stop offset="1" stopColor="#f0c85b" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="0 -24;0 0;0 24"
            dur="5s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <path
        fill="url(#persona-icon-gradient)"
        d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2m6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56M12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96M4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84.63-3.37-1.9-4.33-3.56m2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8M12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c.43-1.43 1.08-2.76 1.91-3.96M14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.35.16 2s-.1 1.35-.26 2m.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56M16.36 14c.08-.66.14-1.32.14-2s-.1-1.36-.26-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2z"
      />
    </SvgIcon>
  );
}

export default function ProjectPage() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { mode } = useThemeMode();

  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<Version | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [search, setSearch] = useState('');

  const isOwner = project?.role === 'owner';
  const openTotal = versions?.reduce((total, version) => total + version.open_count, 0) ?? 0;

  const load = () => {
    if (!projectId) return;
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => navigate('/'));
    api
      .listVersions(projectId)
      .then(setVersions)
      .catch(() => setVersions([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const create = async () => {
    if (!label.trim() || !url.trim() || !projectId) return;
    setSaving(true);
    try {
      await api.createVersion(projectId, label.trim(), url.trim());
      setOpen(false);
      setLabel('');
      setUrl('');
      load();
    } finally {
      setSaving(false);
    }
  };

  const deleteVersion = async (id: string) => {
    setMenuAnchor(null);
    setMenuFor(null);
    await api.deleteVersion(id);
    load();
  };

  const filteredVersions = versions?.filter((version) => {
    const needle = search.trim().toLowerCase();
    return !needle || `${version.label} ${version.url}`.toLowerCase().includes(needle);
  });

  return (
    <Layout>
      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3.5 }, px: { xs: 2, sm: 3 } }}>
        <Breadcrumbs
          separator="/"
          sx={{
            mb: 1.25,
            fontSize: 13,
            '& .MuiBreadcrumbs-separator': { color: 'text.secondary', mx: 0.9 },
          }}
        >
          <Link
            underline="hover"
            color="inherit"
            onClick={() => navigate('/')}
            sx={{ cursor: 'pointer' }}
          >
            {t('project.breadcrumb')}
          </Link>
          <Typography color="text.primary">{project?.name ?? '…'}</Typography>
        </Breadcrumbs>

        <Box
          display="flex"
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'flex-end' }}
          gap={2}
          mb={2.5}
          flexDirection={{ xs: 'column', md: 'row' }}
        >
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.03em', mb: 0.2 }}>
              {project?.name}
            </Typography>
            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 400 }}>
              {t('project.countSummary', { count: versions?.length ?? 0, open: openTotal })}
            </Typography>
          </Box>
          {isOwner && (
            <Box display="flex" gap={1}>
              <Button
                variant="outlined"
                startIcon={<PersonAddIcon />}
                onClick={() => setShareOpen(true)}
                sx={{ minHeight: 38, px: 1.4, borderWidth: 2, fontSize: 14 }}
              >
                {t('common.share')}
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setOpen(true)}
                sx={{ minHeight: 38, px: 1.6, fontWeight: 700, fontSize: 14 }}
              >
                {t('project.newPersona')}
              </Button>
            </Box>
          )}
        </Box>

        <TextField
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('project.searchPlaceholder')}
          aria-label={t('project.searchLabel')}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.primary', fontSize: 22 }} />,
          }}
          sx={{
            mb: 2,
            '& .MuiOutlinedInput-root': { minHeight: 38, borderRadius: 1.5, fontSize: 14 },
          }}
        />

        {versions === null ? (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress />
          </Box>
        ) : versions.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
            {t('project.empty')}
          </Typography>
        ) : (
          <Box className="personas-list">
            <List sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {filteredVersions?.map((v) => (
                <ListItem
                  key={v.id}
                  disablePadding
                  sx={{
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.paper',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    '&:hover': {
                      borderColor: 'primary.main',
                      boxShadow: '0 7px 22px rgba(0,0,0,.12)',
                    },
                  }}
                >
                  <ListItemButton
                    onClick={() => navigate(`/projects/${projectId}/versions/${v.id}`)}
                    sx={{
                      minHeight: { xs: 84, md: 94 },
                      px: { xs: 1.25, md: 1.75 },
                      py: 1,
                      gap: 1.25,
                    }}
                  >
                    <Box
                      sx={{
                        flex: '0 0 auto',
                        width: 48,
                        height: 48,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 1.5,
                        bgcolor: mode === 'light' ? '#e3efed' : 'action.hover',
                      }}
                    >
                      <PersonaLanguageIcon />
                    </Box>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                          <Typography variant="body1" sx={{ fontWeight: 700 }}>
                            {v.label}
                          </Typography>
                          <Typography
                            component="span"
                            sx={{
                              px: 0.65,
                              py: 0.05,
                              border: '1px solid',
                              borderColor: 'primary.main',
                              borderRadius: 3,
                              color: 'primary.main',
                              fontWeight: 700,
                              fontSize: 10,
                            }}
                          >
                            P{v.seq}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ mt: 0.15, maxWidth: { xs: 180, md: 600 } }}
                        >
                          {v.url}
                        </Typography>
                      }
                    />
                    <Box
                      display="flex"
                      gap={1}
                      alignItems="center"
                      sx={{ ml: 'auto', mr: { xs: 0, md: 1 }, flexShrink: 0 }}
                    >
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          gap: 0.35,
                          px: 0.75,
                          py: 0.3,
                          borderRadius: 3,
                          bgcolor: v.open_count
                            ? mode === 'light'
                              ? '#c35b0b'
                              : '#f6b74a'
                            : 'transparent',
                          border: v.open_count ? 'none' : '1px solid',
                          borderColor: 'divider',
                          color: v.open_count
                            ? mode === 'light'
                              ? '#ffffff'
                              : '#0b1220'
                            : 'text.primary',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        <ErrorOutlineIcon fontSize="small" />{' '}
                        {t('project.openCount', { count: v.open_count })}
                      </Box>
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          gap: 0.35,
                          px: 0.75,
                          py: 0.3,
                          borderRadius: 3,
                          border: '1px solid',
                          borderColor: 'success.main',
                          color: 'success.main',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        <CheckCircleOutlineIcon fontSize="small" />{' '}
                        {t('project.resolvedCount', { count: v.resolved_count })}
                      </Box>
                    </Box>
                    <OpenInNewIcon sx={{ display: { xs: 'none', md: 'block' }, fontSize: 21 }} />
                    {isOwner && (
                      <IconButton
                        edge="end"
                        aria-label={t('project.versionActions', { label: v.label })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(v);
                          setMenuAnchor(e.currentTarget);
                        }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={() => menuFor && deleteVersion(menuFor.id)}>
            {t('project.deletePersona')}
          </MenuItem>
        </Menu>

        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>{t('project.newPersona')}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label={t('project.personaLabel')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              sx={{ mt: 1, mb: 2 }}
              placeholder={t('project.personaLabelPlaceholder')}
            />
            <TextField
              fullWidth
              label={t('project.designUrl')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('project.designUrlPlaceholder')}
              helperText={t('project.designUrlHelper')}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={create}
              disabled={saving || !label.trim() || !url.trim()}
            >
              {t('common.create')}
            </Button>
          </DialogActions>
        </Dialog>

        <ShareProjectDialog
          open={shareOpen}
          projectId={projectId ?? ''}
          onClose={() => setShareOpen(false)}
        />
      </Container>
    </Layout>
  );
}
