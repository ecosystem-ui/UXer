import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Drawer,
  Switch,
  FormControlLabel,
  TextField,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Stack,
  Divider,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { api } from '../api/client';
import type { Version, Comment, CommentStatus } from '../api/types';
import type { Anchor, Pin } from '../bridge-protocol';
import { sendToBridge } from '../bridge-protocol';

export default function PreviewPage() {
  const { projectId, versionId } = useParams<{ projectId: string; versionId: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [version, setVersion] = useState<Version | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [showResolved, setShowResolved] = useState(true);
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const reload = async (id: string) => {
    try {
      const cs = await api.listComments(id);
      setComments(cs);
    } catch {
      setComments([]);
    }
  };

  // Load version metadata.
  useEffect(() => {
    if (!projectId || !versionId) return;
    api
      .listVersions(projectId)
      .then((vs) => {
        const v = vs.find((x) => x.id === versionId);
        if (v) setVersion(v);
        else navigate(`/projects/${projectId}`);
      })
      .catch(() => navigate(`/projects/${projectId}`));
  }, [projectId, versionId, navigate]);

  // Load comments.
  useEffect(() => {
    if (versionId) reload(versionId);
  }, [versionId]);

  // Listen for bridge messages (element anchor captures).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== 'uxer-bridge') return;
      if (d.type === 'anchor') {
        setPendingAnchor(d.anchor);
        setCommentMode(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Propagate mode changes into the iframe.
  useEffect(() => {
    sendToBridge(iframeRef.current?.contentWindow ?? null, {
      source: 'uxer',
      type: 'mode',
      mode: commentMode ? 'comment' : 'browse',
    });
  }, [commentMode]);

  // Derive pins from comments and push them into the iframe.
  const pins = useMemo<Pin[]>(() => {
    if (!comments) return [];
    return comments.map((c, i) => ({
      id: c.id,
      selector: c.selector,
      x: c.x,
      y: c.y,
      status: c.status,
      index: i + 1,
    }));
  }, [comments]);

  useEffect(() => {
    if (!comments) return;
    sendToBridge(iframeRef.current?.contentWindow ?? null, { source: 'uxer', type: 'pins', pins });
  }, [pins, comments]);

  const focusComment = (c: Comment) => {
    setActiveCommentId(c.id);
    sendToBridge(iframeRef.current?.contentWindow ?? null, {
      source: 'uxer',
      type: 'focus',
      selector: c.selector,
    });
  };

  const submitComment = async () => {
    if (!pendingAnchor || !versionId || !draftBody.trim()) return;
    await api.createComment(versionId, {
      selector: pendingAnchor.selector,
      text_excerpt: pendingAnchor.text,
      x: pendingAnchor.x,
      y: pendingAnchor.y,
      body: draftBody.trim(),
    });
    setPendingAnchor(null);
    setDraftBody('');
    await reload(versionId);
  };

  const setStatus = async (c: Comment, status: CommentStatus) => {
    await api.updateComment(c.id, { status, resolved_version_id: versionId });
    await reload(versionId!);
  };

  const addReply = async (c: Comment) => {
    const body = (replyText[c.id] ?? '').trim();
    if (!body) return;
    await api.createReply(c.id, body);
    setReplyText((s) => ({ ...s, [c.id]: '' }));
    await reload(versionId!);
  };

  const visible = (comments ?? []).filter((c) => showResolved || c.status === 'open');
  const openCount = (comments ?? []).filter((c) => c.status === 'open').length;

  if (!version) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar
        position="static"
        elevation={0}
        color="default"
        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Toolbar variant="dense">
          <Tooltip title="Back to versions">
            <IconButton edge="start" onClick={() => navigate(`/projects/${projectId}`)}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="subtitle1" fontWeight={600} sx={{ ml: 1 }}>
            {version.label}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 2, maxWidth: 320 }}>
            {version.url}
          </Typography>

          <Box flexGrow={1} />

          <Chip size="small" color="primary" variant="outlined" label={`${openCount} open`} sx={{ mr: 1 }} />
          <FormControlLabel
            sx={{ mr: 1 }}
            control={
              <Switch
                size="small"
                color="primary"
                checked={commentMode}
                onChange={(e) => setCommentMode(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Comment mode</Typography>}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Resolved</Typography>}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Box sx={{ flexGrow: 1, position: 'relative', bgcolor: 'grey.200' }}>
          <iframe
            ref={iframeRef}
            src={`/proxy?url=${encodeURIComponent(version.url)}`}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            title="design preview"
          />
        </Box>

        <Drawer
          variant="permanent"
          anchor="right"
          sx={{
            width: 380,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: 380,
              position: 'relative',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Comments ({comments?.length ?? 0})
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
            {comments === null ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            ) : visible.length === 0 ? (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                No comments yet. Enable comment mode and click an element to leave one.
              </Typography>
            ) : (
              visible.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  active={c.id === activeCommentId}
                  replyText={replyText[c.id] ?? ''}
                  onFocus={() => focusComment(c)}
                  onSetStatus={(s) => setStatus(c, s)}
                  onReply={() => addReply(c)}
                  onReplyChange={(t) => setReplyText((s) => ({ ...s, [c.id]: t }))}
                />
              ))
            )}
          </Box>
        </Drawer>
      </Box>

      <Dialog
        open={Boolean(pendingAnchor)}
        onClose={() => {
          setPendingAnchor(null);
          setDraftBody('');
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>New comment</DialogTitle>
        <DialogContent>
          {pendingAnchor?.text ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 1.5, fontStyle: 'italic', bgcolor: 'grey.100', p: 1.5, borderRadius: 1 }}
            >
              “{pendingAnchor.text}”
            </Typography>
          ) : null}
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Comment"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPendingAnchor(null);
              setDraftBody('');
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={submitComment} disabled={!draftBody.trim()}>
            Add comment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface CommentCardProps {
  comment: Comment;
  active: boolean;
  replyText: string;
  onFocus: () => void;
  onSetStatus: (s: CommentStatus) => void;
  onReply: () => void;
  onReplyChange: (t: string) => void;
}

function CommentCard({
  comment,
  active,
  replyText,
  onFocus,
  onSetStatus,
  onReply,
  onReplyChange,
}: CommentCardProps) {
  const author = comment.author;
  const resolved = comment.status === 'resolved';

  return (
    <Box
      onClick={onFocus}
      sx={{
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: active ? 'action.hover' : 'transparent',
        cursor: 'pointer',
        opacity: resolved ? 0.75 : 1,
      }}
    >
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Avatar src={author?.avatar_url} alt={author?.login} sx={{ width: 28, height: 28 }}>
          {(author?.login || '?').charAt(0).toUpperCase()}
        </Avatar>
        <Typography variant="body2" fontWeight={600}>
          {author?.name || author?.login}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {new Date(comment.created_at).toLocaleString()}
        </Typography>
        <Box flexGrow={1} />
        <Chip
          size="small"
          color={resolved ? 'success' : 'primary'}
          variant="outlined"
          label={resolved ? 'resolved' : 'open'}
        />
      </Box>

      <Typography variant="body2" sx={{ mb: 1 }}>
        {comment.body}
      </Typography>

      {comment.text_excerpt ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            mb: 1,
            fontStyle: 'italic',
            bgcolor: 'grey.100',
            p: 1,
            borderRadius: 1,
          }}
        >
          {comment.text_excerpt}
        </Typography>
      ) : null}

      {comment.replies.map((r) => (
        <Box
          key={r.id}
          sx={{
            ml: 2,
            mt: 1,
            pl: 1.5,
            borderLeft: '2px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" fontWeight={600}>
            {r.author?.name || r.author?.login}
          </Typography>
          <Typography variant="body2">{r.body}</Typography>
        </Box>
      ))}

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <TextField
          size="small"
          fullWidth
          placeholder="Reply…"
          value={replyText}
          onChange={(e) => onReplyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onReply();
            }
          }}
        />
        <Button size="small" onClick={onReply} disabled={!replyText.trim()}>
          Reply
        </Button>
      </Stack>

      <Box sx={{ mt: 1 }} onClick={(e) => e.stopPropagation()}>
        <Divider sx={{ mb: 0.5 }} />
        <Button
          size="small"
          color={resolved ? 'inherit' : 'success'}
          startIcon={resolved ? <ReplayIcon /> : <CheckCircleOutlineIcon />}
          onClick={() => onSetStatus(resolved ? 'open' : 'resolved')}
        >
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </Box>
    </Box>
  );
}
