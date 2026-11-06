import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Button,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Layout from '../components/Layout';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useThemeMode } from '../theme/ThemeModeContext';

export default function HomePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { mode } = useThemeMode();
  const navigate = useNavigate();

  const load = () =>
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const p = await api.createProject(name.trim());
      setOpen(false);
      setName('');
      navigate(`/projects/${p.id}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.deleteProject(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Layout>
      <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, maxWidth: 1280 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={{ xs: 2.5, md: 3 }}>
          <Typography variant="h5" fontWeight={600}>
            Projects
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            New project
          </Button>
        </Box>

        {projects === null ? (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress />
          </Box>
        ) : projects.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
            No projects yet. Create your first project to start reviewing designs.
          </Typography>
        ) : (
          <Box className="projects-grid">
            {projects.map((p) => (
              <Box key={p.id} sx={{ minWidth: 0 }}>
                <Card className={`project-card project-card--${mode}`} variant="outlined" sx={{ position: 'relative', display: 'flex' }}>
                  <CardActionArea onClick={() => navigate(`/projects/${p.id}`)} sx={{ flex: 1, minWidth: 0, minHeight: { xs: 136, md: 148 }, display: 'flex', alignItems: 'stretch' }}>
                    <CardContent sx={{ width: '100%', p: { xs: 1.5, md: 1.75 }, pl: { xs: 2.5, md: 2.75 }, pb: { xs: 1.5, md: 1.75 }, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <Box className="project-card__folder" aria-hidden="true">
                        <FolderOutlinedIcon />
                      </Box>
                      <Typography variant="h6" noWrap sx={{ mt: 'auto', maxWidth: 'calc(100% - 24px)', fontWeight: 700, letterSpacing: -0.2 }}>
                        {p.name}
                      </Typography>
                      <Typography variant="body2" sx={{ display: 'block', mt: 0.45, color: '#8f9aa5', fontSize: { xs: 11, md: 12 }, lineHeight: 1.3 }}>
                        Updated {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{' · '}{new Date(p.updated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </Typography>
                      {p.role === 'viewer' && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          Shared by {p.owner_name || 'someone'}
                        </Typography>
                      )}
                    </CardContent>
                  </CardActionArea>
                  {p.role !== 'viewer' && (
                    <IconButton
                      size="small"
                      aria-label={`Project actions for ${p.name}`}
                      sx={{ alignSelf: 'flex-start', flexShrink: 0, mt: { xs: 1.5, md: 1.75 }, mr: 1, color: '#f5f7fa' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(p);
                        setMenuAnchor(e.currentTarget);
                      }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  )}
                  {p.role === 'viewer' && (
                    <ArrowForwardIcon aria-hidden="true" sx={{ position: 'absolute', right: { xs: 18, md: 30 }, top: '50%', transform: 'translateY(-50%)', color: '#d5dbe1', fontSize: 30 }} />
                  )}
                </Card>
              </Box>
            ))}
          </Box>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              if (menuFor) setConfirmDelete(menuFor);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            Delete project
          </MenuItem>
        </Menu>

        <Dialog
          open={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Delete project?</DialogTitle>
          <DialogContent>
            <Typography>
              This will permanently delete "{confirmDelete?.name}" and all of its versions,
              comments, and replies.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              startIcon={<DeleteOutlineIcon />}
              onClick={deleteProject}
              disabled={deleting}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>New project</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={create} disabled={saving || !name.trim()}>
              Create
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Layout>
  );
}
