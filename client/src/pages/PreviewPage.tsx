import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  Button,
  TextField,
  Avatar,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddCommentIcon from '@mui/icons-material/AddComment';
import CheckIcon from '@mui/icons-material/Check';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import { api } from '../api/client';
import type { Version, Comment, CommentStatus, Reply } from '../api/types';
import type { Anchor, Pin } from '../bridge-protocol';
import { sendToBridge } from '../bridge-protocol';
import { useThemeMode } from '../theme/ThemeModeContext';

type Filter = 'open' | 'resolved' | 'all';
type Sort = 'newest' | 'oldest';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (Number.isNaN(secs) || secs < 0) return '';
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type Authorish = { author?: { name: string; email: string } | null };
function displayName(a: Authorish | null | undefined): string {
  return a?.author?.name || a?.author?.email || 'Anonymous';
}

// Normalize a stored page_url to a navigable design URL. Handles legacy
// values that were accidentally stored in proxied form.
function normalizeDesignUrl(pageUrl: string): string {
  if (!pageUrl) return '';
  const marker = '/__uxer__/p/';
  const idx = pageUrl.indexOf(marker);
  if (idx === -1) return pageUrl;
  const token = pageUrl.slice(idx + marker.length);
  const slash = token.indexOf('/');
  const b64 = slash === -1 ? token : token.slice(0, slash);
  const rest = slash === -1 ? '' : token.slice(slash);
  try {
    let b = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4 !== 0) b += '=';
    const decoded = atob(b);
    const nl = decoded.indexOf('\n');
    const origin = nl === -1 ? decoded : decoded.slice(0, nl);
    return origin + rest;
  } catch {
    return '';
  }
}

export default function PreviewPage() {
  const { projectId, versionId } = useParams<{ projectId: string; versionId: string }>();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { tokens } = useThemeMode();

  const [version, setVersion] = useState<Version | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('newest');
  const [query, setQuery] = useState('');
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const pinsRef = useRef<Pin[]>([]);

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

  // Listen for bridge messages (element anchor captures, navigation, ready).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== 'uxer-bridge') return;
      if (d.type === 'anchor') {
        setPendingAnchor(d.anchor);
        setCommentMode(false);
      } else if (d.type === 'ready') {
        setCurrentUrl(typeof d.url === 'string' ? d.url : '');
        // The bridge (re)loaded: restore pins.
        if (pinsRef.current.length) {
          sendToBridge(iframeRef.current?.contentWindow ?? null, {
            source: 'uxer',
            type: 'pins',
            pins: pinsRef.current,
          });
        }
      } else if (d.type === 'location') {
        setCurrentUrl(typeof d.url === 'string' ? d.url : '');
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
      url: normalizeDesignUrl(c.page_url) || '',
    }));
  }, [comments]);

  useEffect(() => {
    if (!comments) return;
    pinsRef.current = pins;
    sendToBridge(iframeRef.current?.contentWindow ?? null, { source: 'uxer', type: 'pins', pins });
  }, [pins, comments]);

  const sendFocus = (selector: string) => {
    sendToBridge(iframeRef.current?.contentWindow ?? null, {
      source: 'uxer',
      type: 'focus',
      selector,
    });
  };

  const focusComment = (c: Comment) => {
    setActiveId(c.id);
    const target = normalizeDesignUrl(c.page_url);
    // No page URL recorded (legacy): just focus on the current page.
    if (!target) {
      sendFocus(c.selector);
      return;
    }
    // Already on the comment's page: just focus the element.
    if (currentUrl === target) {
      sendFocus(c.selector);
      return;
    }
    // Navigate the SPA client-side via the bridge (same origin). Deep links
    // aren't served by the origin (e.g. GitHub Pages), so a full reload would
    // 404. Cross-origin targets fall back to a full reload.
    const win = iframeRef.current?.contentWindow ?? null;
    let sameOrigin = true;
    try {
      sameOrigin = new URL(target).origin === new URL(version!.url).origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin) {
      sendToBridge(win, { source: 'uxer', type: 'navigate', url: target, selector: c.selector });
    } else {
      iframeRef.current!.src = `/proxy?url=${encodeURIComponent(target)}`;
    }
  };

  const openDetail = (c: Comment) => {
    setDetailId(c.id);
    focusComment(c);
  };

  const submitComment = async (body: string) => {
    if (!pendingAnchor || !versionId || !body.trim()) return;
    const created = await api.createComment(versionId, {
      selector: pendingAnchor.selector,
      text_excerpt: pendingAnchor.text,
      page_url: normalizeDesignUrl(pendingAnchor.url || '') || version?.url || '',
      x: pendingAnchor.x,
      y: pendingAnchor.y,
      body: body.trim(),
    });
    setPendingAnchor(null);
    await reload(versionId);
    setFilter((f) => (f === 'resolved' ? 'open' : f));
    setActiveId(created.id);
  };

  const setStatus = async (c: Comment, status: CommentStatus) => {
    await api.updateComment(c.id, { status, resolved_version_id: versionId });
    await reload(versionId!);
  };

  const addReply = async (c: Comment, body: string) => {
    await api.createReply(c.id, body);
    await reload(versionId!);
  };

  const deleteThread = async (c: Comment) => {
    await api.deleteComment(c.id);
    setDetailId(null);
    await reload(versionId!);
  };

  const list = comments ?? [];
  const openCount = list.filter((c) => c.status === 'open').length;
  const resolvedCount = list.filter((c) => c.status === 'resolved').length;
  const counts: Record<Filter, number> = {
    open: openCount,
    resolved: resolvedCount,
    all: list.length,
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((c) => filter === 'all' || c.status === filter)
      .filter(
        (c) =>
          !q ||
          [
            c.body,
            c.text_excerpt,
            c.author?.name ?? '',
            c.author?.email ?? '',
            ...(c.replies ?? []).map((r) => `${r.body} ${r.author?.name ?? ''} ${r.author?.email ?? ''}`),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) =>
        sort === 'newest'
          ? +new Date(b.created_at) - +new Date(a.created_at)
          : +new Date(a.created_at) - +new Date(b.created_at),
      );
  }, [list, filter, query, sort]);

  const detail = list.find((c) => c.id === detailId) ?? null;
  const indexOf = (id: string) => list.findIndex((c) => c.id === id) + 1;

  if (!version) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  const emptyTitle = query
    ? 'No matching comments'
    : filter === 'open'
      ? 'All caught up'
      : 'No comments here';
  const emptySubtitle = query
    ? 'Try a different search.'
    : 'Turn on comment mode and click the page to leave feedback.';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.paper' }}>
      {/* Header */}
      <Box
        component="header"
        sx={{
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <IconButton
          size="small"
          onClick={() => navigate(`/projects/${projectId}`)}
          aria-label="Back to versions"
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" fontWeight={600}>
          v{version.seq}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ minWidth: 0, flex: '1 1 auto' }}
        >
          {version.url}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            component="span"
            sx={{
              borderRadius: 999,
              bgcolor: tokens.openSoft,
              color: tokens.open,
              px: 1.25,
              py: 0.25,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {openCount} open
          </Box>
          <Button
            size="small"
            onClick={() => {
              setCommentMode((m) => !m);
              setPendingAnchor(null);
            }}
            startIcon={<AddCommentIcon sx={{ fontSize: 16 }} />}
            sx={{
              border: '1px solid',
              borderColor: commentMode ? 'primary.main' : 'divider',
              bgcolor: commentMode ? 'primary.main' : 'transparent',
              color: commentMode ? 'primary.contrastText' : 'text.primary',
              px: 1.5,
              py: 0.75,
              fontSize: 14,
              fontWeight: 500,
              '&:hover': commentMode
                ? { bgcolor: 'primary.main' }
                : { bgcolor: tokens.muted, borderColor: 'divider' },
            }}
          >
            {commentMode ? 'Click page to comment' : 'Comment mode'}
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        {/* Preview */}
        <Box sx={{ flexGrow: 1, position: 'relative', bgcolor: tokens.canvas }}>
          <iframe
            ref={iframeRef}
            src={`/proxy?url=${encodeURIComponent(version.url)}`}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            title="design preview"
          />
        </Box>

        {/* Comments panel */}
        <Box
          component="aside"
          sx={{
            width: 380,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {detail ? (
            <ThreadDetail
              key={detail.id}
              comment={detail}
              index={indexOf(detail.id)}
              onBack={() => setDetailId(null)}
              onReply={(body) => addReply(detail, body)}
              onToggle={() => setStatus(detail, detail.status === 'open' ? 'resolved' : 'open')}
              onDelete={() => deleteThread(detail)}
            />
          ) : (
            <>
              {/* Panel header */}
              <Box
                sx={{
                  p: 2,
                  borderBottom: 1,
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle1" fontWeight={600}>
                    Comments
                  </Typography>
                  <Box
                    component="select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    sx={{
                      border: 'none',
                      bgcolor: 'transparent',
                      color: 'text.secondary',
                      fontSize: 12,
                      outline: 'none',
                      cursor: 'pointer',
                      '&:hover': { color: 'text.primary' },
                    }}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </Box>
                </Box>

                <FilterSeg value={filter} onChange={setFilter} counts={counts} />

                <Box
                  component="label"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    px: 1.25,
                    py: 0.75,
                    '&:focus-within': {
                      borderColor: 'primary.main',
                      boxShadow: '0 0 0 2px rgba(15, 23, 43, 0.12)',
                    },
                  }}
                >
                  <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Box
                    component="input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search comments"
                    sx={{
                      width: '100%',
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 14,
                      color: 'text.primary',
                      '::placeholder': { color: 'text.secondary', opacity: 0.8 },
                    }}
                  />
                  {query && (
                    <IconButton size="small" onClick={() => setQuery('')} aria-label="Clear search">
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                </Box>
              </Box>

              {pendingAnchor && (
                <NewCommentComposer
                  excerpt={pendingAnchor.text}
                  onCancel={() => setPendingAnchor(null)}
                  onSubmit={submitComment}
                />
              )}

              {/* Comment list */}
              <Box
                sx={{
                  flexGrow: 1,
                  overflowY: 'auto',
                  bgcolor: tokens.canvas,
                  p: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                {comments === null ? (
                  <Box display="flex" justifyContent="center" py={4}>
                    <CircularProgress />
                  </Box>
                ) : visible.length === 0 ? (
                  <Box sx={{ px: 3, py: 8, textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight={600}>
                      {emptyTitle}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {emptySubtitle}
                    </Typography>
                  </Box>
                ) : (
                  visible.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      index={indexOf(c.id)}
                      active={activeId === c.id}
                      onOpen={() => openDetail(c)}
                      onToggle={() => setStatus(c, c.status === 'open' ? 'resolved' : 'open')}
                    />
                  ))
                )}
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function FilterSeg({
  value,
  onChange,
  counts,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const { tokens } = useThemeMode();
  const items: Filter[] = ['open', 'resolved', 'all'];
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 0.5,
        bgcolor: tokens.muted,
        borderRadius: 2,
        p: 0.5,
      }}
    >
      {items.map((f) => (
        <Box
          key={f}
          component="button"
          type="button"
          onClick={() => onChange(f)}
          sx={{
            border: 'none',
            cursor: 'pointer',
            py: 0.75,
            borderRadius: 1.5,
            fontSize: 14,
            fontWeight: 500,
            textTransform: 'capitalize',
            color: value === f ? tokens.foreground : tokens.mutedForeground,
            bgcolor: value === f ? 'background.paper' : 'transparent',
            boxShadow: value === f ? '0 1px 2px rgba(2, 6, 24, 0.08)' : 'none',
            transition: 'all .15s ease',
            '&:hover': value !== f ? { color: tokens.foreground } : {},
          }}
        >
          {f} <Box component="span" sx={{ fontSize: 12, opacity: 0.7 }}>{counts[f]}</Box>
        </Box>
      ))}
    </Box>
  );
}

function NewCommentComposer({
  excerpt,
  onCancel,
  onSubmit,
}: {
  excerpt: string;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const { tokens } = useThemeMode();
  const [text, setText] = useState('');
  return (
    <Box
      sx={{
        p: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: tokens.openSoft,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Typography variant="caption" fontWeight={600} color={tokens.open}>
        New comment
      </Typography>
      {excerpt && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            alignSelf: 'flex-start',
            maxWidth: '100%',
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            fontSize: 13,
            color: 'text.secondary',
          }}
        >
          <FormatQuoteIcon sx={{ fontSize: 12 }} />
          <Typography component="span" variant="caption" noWrap sx={{ maxWidth: 280 }}>
            {excerpt}
          </Typography>
        </Box>
      )}
      <TextField
        autoFocus
        multiline
        minRows={3}
        fullWidth
        size="small"
        placeholder="Write a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text.trim());
          if (e.key === 'Escape') onCancel();
        }}
      />
      <Box display="flex" justifyContent="flex-end" gap={1}>
        <Button
          size="small"
          onClick={onCancel}
          sx={{ color: 'text.primary', '&:hover': { bgcolor: 'background.paper' } }}
        >
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
          Comment
        </Button>
      </Box>
    </Box>
  );
}

function CommentCard({
  comment,
  index,
  active,
  onOpen,
  onToggle,
}: {
  comment: Comment;
  index: number;
  active: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { tokens } = useThemeMode();
  const resolved = comment.status === 'resolved';
  const name = displayName(comment);
  const replies = comment.replies ?? [];
  const last = replies[replies.length - 1];
  const people = Array.from(
    new Set([comment.author?.name || comment.author?.email || 'Anonymous', ...replies.map((r) => displayName(r))]),
  );

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      sx={{
        cursor: 'pointer',
        borderRadius: 2,
        border: 1,
        borderColor: active ? tokens.open : 'divider',
        bgcolor: 'background.paper',
        p: 1.5,
        opacity: resolved ? 0.75 : 1,
        transition: 'box-shadow .15s ease, border-color .15s ease',
        '&:hover': { boxShadow: '0 1px 3px rgba(2, 6, 24, 0.12)' },
        '&:hover .resolve-btn': { opacity: 1 },
      }}
    >
      <Box display="flex" alignItems="center" gap={1}>
        <Box
          component="span"
          sx={{
            height: 20,
            minWidth: 20,
            px: 0.5,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: '#fff',
            bgcolor: resolved ? tokens.resolved : tokens.open,
          }}
        >
          {index}
        </Box>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 160 }}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {timeAgo(comment.created_at)}
        </Typography>
        <IconButton
          size="small"
          className="resolve-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={resolved ? 'Reopen' : 'Resolve'}
          sx={{
            ml: 'auto',
            opacity: 0,
            transition: 'opacity .15s ease',
            color: resolved ? 'text.secondary' : tokens.resolved,
            '&:hover': { bgcolor: resolved ? tokens.muted : tokens.resolvedSoft },
          }}
        >
          {resolved ? <ReplayIcon sx={{ fontSize: 14 }} /> : <CheckIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: resolved ? 'text.secondary' : 'text.primary',
          textDecoration: resolved ? 'line-through' : 'none',
          textDecorationColor: 'rgba(98, 116, 142, 0.4)',
        }}
      >
        {comment.body}
      </Typography>

      {comment.text_excerpt && (
        <Box
          component="span"
          sx={{
            mt: 0.75,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            maxWidth: '100%',
            bgcolor: tokens.muted,
            px: 0.75,
            py: 0.25,
            borderRadius: 0.75,
            fontSize: 12,
            color: 'text.secondary',
          }}
        >
          <FormatQuoteIcon sx={{ fontSize: 12 }} />
          <Typography component="span" variant="caption" noWrap sx={{ maxWidth: 260 }}>
            {comment.text_excerpt}
          </Typography>
        </Box>
      )}

      <Box
        display="flex"
        alignItems="center"
        gap={1}
        sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider', fontSize: 12, color: 'text.secondary' }}
      >
        {replies.length > 0 ? (
          <>
            <Box sx={{ display: 'flex' }}>
              {people.slice(0, 3).map((p, i) => (
                <Avatar
                  key={p}
                  sx={{
                    width: 20,
                    height: 20,
                    fontSize: 10,
                    bgcolor: tokens.ink,
                    color: '#fff',
                    border: '2px solid',
                    borderColor: 'background.paper',
                    ml: i === 0 ? 0 : -0.75,
                  }}
                >
                  {p.charAt(0).toUpperCase()}
                </Avatar>
              ))}
            </Box>
            <Typography variant="caption" fontWeight={600} color={tokens.open} noWrap>
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </Typography>
            <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
              · {displayName(last)}: {last!.body}
            </Typography>
          </>
        ) : (
          <Typography variant="caption" sx={{ flexGrow: 1 }}>
            No replies yet
          </Typography>
        )}
        <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
      </Box>
    </Box>
  );
}

function ThreadDetail({
  comment,
  index,
  onBack,
  onReply,
  onToggle,
  onDelete,
}: {
  comment: Comment;
  index: number;
  onBack: () => void;
  onReply: (body: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { tokens } = useThemeMode();
  const resolved = comment.status === 'resolved';
  const name = displayName(comment);
  const replies = comment.replies ?? [];
  const [reply, setReply] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [replies.length]);

  const send = () => {
    if (reply.trim()) {
      onReply(reply.trim());
      setReply('');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      {/* Detail header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <IconButton size="small" onClick={onBack} aria-label="Back to all comments">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>
            Thread #{index}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {replies.length + 1} messages · {resolved ? 'Resolved' : 'Open'}
          </Typography>
        </Box>
        <Button
          size="small"
          onClick={onToggle}
          startIcon={resolved ? <ReplayIcon sx={{ fontSize: 16 }} /> : <CheckIcon sx={{ fontSize: 16 }} />}
          sx={{
            color: resolved ? 'text.primary' : tokens.resolved,
            border: '1px solid',
            borderColor: resolved ? 'divider' : tokens.resolved,
            px: 1.25,
            py: 0.5,
            fontSize: 12,
            fontWeight: 500,
            '&:hover': {
              bgcolor: resolved ? tokens.muted : tokens.resolvedSoft,
              borderColor: resolved ? 'divider' : tokens.resolved,
            },
          }}
        >
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
        <IconButton
          size="small"
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
          onBlur={() => setConfirm(false)}
          title="Delete thread"
          sx={{
            color: confirm ? 'error.contrastText' : 'text.secondary',
            bgcolor: confirm ? 'error.main' : 'transparent',
            '&:hover': { bgcolor: confirm ? 'error.main' : tokens.muted, color: 'text.primary' },
          }}
        >
          {confirm ? (
            <Typography variant="caption" sx={{ px: 0.5, fontWeight: 500 }}>
              Delete?
            </Typography>
          ) : (
            <DeleteOutlineIcon fontSize="small" />
          )}
        </IconButton>
      </Box>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', bgcolor: tokens.canvas, p: 1.5 }}>
        <Box sx={{ borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Box
            component="button"
            type="button"
            onClick={() => setShowOriginal((s) => !s)}
            sx={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              gap: 1.25,
              p: 1.5,
              border: 'none',
              bgcolor: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: tokens.ink, color: '#fff' }}>
              {name.charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="body2" fontWeight={600}>
                  {name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {timeAgo(comment.created_at)}
                </Typography>
              </Box>
              {!showOriginal && (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {comment.body}
                </Typography>
              )}
            </Box>
            <ExpandMoreIcon
              sx={{
                fontSize: 16,
                color: 'text.secondary',
                transform: showOriginal ? 'none' : 'rotate(-90deg)',
                transition: 'transform .15s ease',
              }}
            />
          </Box>
          {showOriginal && (
            <Box sx={{ mt: -0.5, px: 1.5, pb: 1.5, pl: '3.25rem' }}>
              <Typography variant="body2">{comment.body}</Typography>
              {comment.text_excerpt && (
                <Box
                  component="span"
                  sx={{
                    mt: 0.75,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    bgcolor: tokens.muted,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 0.75,
                    fontSize: 12,
                    color: 'text.secondary',
                  }}
                >
                  <FormatQuoteIcon sx={{ fontSize: 12 }} /> {comment.text_excerpt}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {replies.length === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', py: 4 }}
          >
            No replies yet. Start the discussion below.
          </Typography>
        ) : (
          <Box
            sx={{
              position: 'relative',
              mt: 1.5,
              pl: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              '&::before': {
                content: '""',
                position: 'absolute',
                left: '0.85rem',
                top: 0,
                bottom: 8,
                width: 1,
                bgcolor: 'divider',
              },
            }}
          >
            {replies.map((r) => (
              <ReplyRow key={r.id} reply={r} />
            ))}
          </Box>
        )}
        <div ref={endRef} />
      </Box>

      {/* Composer */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        {resolved ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            This thread is resolved. Reopen it to continue the discussion.
          </Typography>
        ) : (
          <Box display="flex" alignItems="flex-end" gap={1}>
            <TextField
              autoFocus
              multiline
              minRows={2}
              fullWidth
              size="small"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === 'Escape') onBack();
              }}
              placeholder="Reply to thread… (Shift+Enter for new line)"
            />
            <IconButton
              onClick={send}
              disabled={!reply.trim()}
              aria-label="Send reply"
              sx={{
                bgcolor: tokens.ink,
                color: '#fff',
                '&:hover': { bgcolor: tokens.ink, opacity: 0.9 },
                '&.Mui-disabled': { bgcolor: tokens.ink, color: '#fff', opacity: 0.4 },
              }}
            >
              <SendIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function ReplyRow({ reply }: { reply: Reply }) {
  const { tokens } = useThemeMode();
  const name = displayName(reply);
  return (
    <Box className="reply-row" sx={{ position: 'relative', display: 'flex', gap: 1.25 }}>
      <Avatar
        sx={{
          zIndex: 1,
          width: 20,
          height: 20,
          fontSize: 10,
          bgcolor: tokens.ink,
          color: '#fff',
          boxShadow: `0 0 0 4px ${tokens.canvas}`,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </Avatar>
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          px: 1.5,
          py: 1,
        }}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="caption" fontWeight={600}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {timeAgo(reply.created_at)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {reply.body}
        </Typography>
      </Box>
    </Box>
  );
}
