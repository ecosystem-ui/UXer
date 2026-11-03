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
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Layout from '../components/Layout';
import { api } from '../api/client';
import type { Project, ProjectMember, Version } from '../api/types';

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
  const [shareOpen, setShareOpen] = useState(false);
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [memberError, setMemberError] = useState('');

  const isOwner = project?.role === 'owner';

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
          <Box display="flex" alignItems="center" gap={1.5}>
            <Typography variant="h5" fontWeight={600}>
              {project?.name}
            </Typography>
            {!isOwner && project?.owner_name && (
              <Chip size="small" label={`Shared by ${project.owner_name}`} variant="outlined" />
            )}
          </Box>
          {isOwner && (
            <Box display="flex" gap={1}>
              <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={openShare}>
                Share
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
                New persona
              </Button>
            </Box>
          )}
        </Box>

        {versions === null ? (
          <Box display="flex" justifyContent="center" py={8}>
            <CircularProgress />
          </Box>
        ) : versions.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
            No personas yet. Add a persona with a label and the design URL.
          </Typography>
        ) : (
          <List
            sx={{
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            {versions.map((v) => (
              <ListItem key={v.id} disablePadding divider>
                <ListItemButton onClick={() => navigate(`/projects/${projectId}/versions/${v.id}`)}>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="subtitle1">{v.label}</Typography>
                        <Chip size="small" label={`p${v.seq}`} variant="outlined" />
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ maxWidth: 520 }}
                      >
                        {v.url}
                      </Typography>
                    }
                  />
                  <Box display="flex" gap={1} alignItems="center" sx={{ mr: 1 }}>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={`${v.open_count} open`}
                    />
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={`${v.resolved_count} resolved`}
                    />
                  </Box>
                </ListItemButton>
                {isOwner && (
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
                )}
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
