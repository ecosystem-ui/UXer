import { useEffect, useState } from 'react';
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
  CircularProgress,
  Breadcrumbs,
  Link,
  Menu,
  MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Layout from '../components/Layout';
import { api } from '../api/client';
import type { Project, ProjectMember, Version } from '../api/types';
import { useThemeMode } from '../theme/ThemeModeContext';

export default function ProjectPage() {
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
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [memberError, setMemberError] = useState('');
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

  const loadMembers = () => {
    if (!projectId) return;
    api
      .listMembers(projectId)
      .then(setMembers)
      .catch(() => setMembers([]));
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

  const openShare = () => {
    setShareOpen(true);
    setMemberEmail('');
    setMemberError('');
    loadMembers();
  };

  const addMember = async () => {
    const email = memberEmail.trim();
    if (!email || !projectId) return;
    setAdding(true);
    setMemberError('');
    try {
      await api.addMember(projectId, email);
      setMemberEmail('');
      loadMembers();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'failed to add');
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!projectId) return;
    await api.removeMember(projectId, userId);
    loadMembers();
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
          sx={{ mb: 1.25, fontSize: 13, '& .MuiBreadcrumbs-separator': { color: 'text.secondary', mx: 0.9 } }}
        >
          <Link
            underline="hover"
            color="inherit"
            onClick={() => navigate('/')}
            sx={{ cursor: 'pointer' }}
          >
            Projects
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
              {versions?.length ?? 0} websites · {openTotal} open issues
            </Typography>
          </Box>
          {isOwner && (
            <Box display="flex" gap={1}>
              <Button
                variant="outlined"
                startIcon={<PersonAddIcon />}
                onClick={openShare}
                sx={{ minHeight: 38, px: 1.4, borderWidth: 2, fontSize: 14 }}
              >
                Share
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setOpen(true)}
                sx={{ minHeight: 38, px: 1.6, fontWeight: 700, fontSize: 14 }}
              >
                New persona
              </Button>
            </Box>
          )}
        </Box>

        <TextField
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search websites..."
          aria-label="Search websites"
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
            No personas yet. Add a persona with a label and the design URL.
          </Typography>
        ) : (
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
                  '&:hover': { borderColor: 'primary.main', boxShadow: '0 7px 22px rgba(0,0,0,.12)' },
                }}
              >
                  <ListItemButton
                  onClick={() => navigate(`/projects/${projectId}/versions/${v.id}`)}
                  sx={{ minHeight: { xs: 84, md: 94 }, px: { xs: 1.25, md: 1.75 }, py: 1, gap: 1.25 }}
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
                      color: 'primary.main',
                    }}
                  >
                    <LanguageIcon sx={{ fontSize: 26 }} />
                  </Box>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                        <Typography variant="body1" sx={{ fontWeight: 700 }}>{v.label}</Typography>
                        <Typography
                          component="span"
                          sx={{ px: 0.65, py: 0.05, border: '1px solid', borderColor: 'primary.main', borderRadius: 3, color: 'primary.main', fontWeight: 700, fontSize: 10 }}
                        >
                          P{v.seq}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ mt: 0.15, maxWidth: { xs: 180, md: 600 } }}>
                        {v.url}
                      </Typography>
                    }
                  />
                  <Box display="flex" gap={1} alignItems="center" sx={{ ml: 'auto', mr: { xs: 0, md: 1 }, flexShrink: 0 }}>
                    <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.35, px: 0.75, py: 0.3, borderRadius: 3, bgcolor: v.open_count ? (mode === 'light' ? '#c35b0b' : '#f6b74a') : 'transparent', border: v.open_count ? 'none' : '1px solid', borderColor: 'divider', color: v.open_count ? (mode === 'light' ? '#ffffff' : '#0b1220') : 'text.primary', fontWeight: 700, fontSize: 12 }}>
                      <ErrorOutlineIcon fontSize="small" /> {v.open_count} open
                    </Box>
                    <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.35, px: 0.75, py: 0.3, borderRadius: 3, border: '1px solid', borderColor: 'success.main', color: 'success.main', fontWeight: 700, fontSize: 12 }}>
                      <CheckCircleOutlineIcon fontSize="small" /> {v.resolved_count} resolved
                    </Box>
                  </Box>
                  <OpenInNewIcon sx={{ display: { xs: 'none', md: 'block' }, fontSize: 21 }} />
                  {isOwner && (
                    <IconButton edge="end" aria-label={`Actions for ${v.label}`} onClick={(e) => { e.stopPropagation(); setMenuFor(v); setMenuAnchor(e.currentTarget); }}>
                      <MoreVertIcon />
                    </IconButton>
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={() => menuFor && deleteVersion(menuFor.id)}>Delete persona</MenuItem>
        </Menu>

        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>New persona</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label="Persona label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              sx={{ mt: 1, mb: 2 }}
              placeholder="e.g. persona 1 — homepage redesign"
            />
            <TextField
              fullWidth
              label="Design URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              helperText="Public URL of the design (page, prototype, Storybook, …)"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={create}
              disabled={saving || !label.trim() || !url.trim()}
            >
              Create
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={shareOpen} onClose={() => setShareOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>Share project</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Viewers can open the project and leave comments, but can't edit personas or manage
              sharing.
            </Typography>
            <Box display="flex" gap={1}>
              <TextField
                fullWidth
                label="Email address"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMember();
                }}
                error={Boolean(memberError)}
                helperText={memberError}
                placeholder="person@example.com"
              />
              <Button
                variant="contained"
                onClick={addMember}
                disabled={adding || !memberEmail.trim()}
                sx={{ alignSelf: 'flex-start', mt: 0.5 }}
              >
                Add
              </Button>
            </Box>
            {members === null ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : members.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No viewers yet.
              </Typography>
            ) : (
              <List sx={{ mt: 1 }}>
                {members.map((m) => (
                  <ListItem
                    key={m.user_id}
                    disablePadding
                    secondaryAction={
                      <IconButton edge="end" onClick={() => removeMember(m.user_id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText primary={m.name || m.email} secondary={`${m.email} · viewer`} />
                  </ListItem>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShareOpen(false)}>Done</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Layout>
  );
}
