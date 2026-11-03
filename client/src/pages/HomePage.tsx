import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Grid,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Layout from '../components/Layout';
import { api } from '../api/client';
import type { Project } from '../api/types';

export default function HomePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
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
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
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
          <Grid container spacing={2}>
            {projects.map((p) => (
              <Grid item xs={12} sm={6} md={4} key={p.id}>
                <Card variant="outlined" sx={{ position: 'relative' }}>
                  <CardActionArea onClick={() => navigate(`/projects/${p.id}`)}>
                    <CardContent sx={{ pr: 6 }}>
                      <Typography variant="h6" noWrap>
                        {p.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Updated {new Date(p.updated_at).toLocaleString()}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                  <IconButton
                    size="small"
                    aria-label={`Project actions for ${p.name}`}
                    sx={{ position: 'absolute', top: 8, right: 8 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(p);
                      setMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
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
