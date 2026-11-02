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
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  CircularProgress,
  Breadcrumbs,
  Link,
  Menu,
  MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import Layout from '../components/Layout';
import { api } from '../api/client';
import type { Project, Version } from '../api/types';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<Version | null>(null);

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

  return (
    <Layout>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Breadcrumbs sx={{ mb: 2 }}>
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

        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h5" fontWeight={600}>
            {project?.name}
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            New version
          </Button>
        </Box>

        {versions === null ? (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress />
          </Box>
        ) : versions.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
            No versions yet. Add a version with a label and the design URL.
          </Typography>
        ) : (
          <List sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            {versions.map((v) => (
              <ListItem key={v.id} disablePadding divider>
                <ListItemButton onClick={() => navigate(`/projects/${projectId}/versions/${v.id}`)}>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="subtitle1">{v.label}</Typography>
                        <Chip size="small" label={`v${v.seq}`} variant="outlined" />
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 520 }}>
                        {v.url}
                      </Typography>
                    }
                  />
                  <Box display="flex" gap={1} alignItems="center" sx={{ mr: 1 }}>
                    <Chip size="small" color="primary" variant="outlined" label={`${v.open_count} open`} />
                    <Chip size="small" color="success" variant="outlined" label={`${v.resolved_count} resolved`} />
                  </Box>
                </ListItemButton>
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    onClick={(e) => {
                      setMenuFor(v);
                      setMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={() => menuFor && deleteVersion(menuFor.id)}>Delete version</MenuItem>
        </Menu>

        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>New version</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label="Version label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              sx={{ mt: 1, mb: 2 }}
              placeholder="e.g. v1 — homepage redesign"
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
      </Container>
    </Layout>
  );
}
