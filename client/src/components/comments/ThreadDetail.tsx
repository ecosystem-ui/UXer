import { useEffect, useRef, useState } from 'react';
import { Box, Typography, IconButton, Button, Avatar, TextField, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckIcon from '@mui/icons-material/Check';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { Comment } from '../../api/types';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { displayName, timeAgo, pageLabel, blockedHint, userColor } from './utils';
import type { BlockedInfo } from './types';
import ReplyRow from './ReplyRow';

export interface ThreadDetailProps {
  comment: Comment;
  index: number;
  canManage: boolean;
  canResolve: boolean;
  blockedInfo?: BlockedInfo;
  onBack: () => void;
  onReply: (body: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}

export default function ThreadDetail({
  comment,
  index,
  canManage,
  canResolve,
  blockedInfo,
  onBack,
  onReply,
  onToggle,
  onDelete,
}: ThreadDetailProps) {
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" fontWeight={600}>
              Thread #{index}
            </Typography>
            {blockedInfo && (
              <Tooltip title={blockedHint(blockedInfo)} arrow>
                <ErrorOutlineIcon sx={{ fontSize: 16, color: '#d97706' }} />
              </Tooltip>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {replies.length + 1} messages · {resolved ? 'Resolved' : 'Open'}
          </Typography>
        </Box>
        {(canResolve || canManage) && (
          <>
            {canResolve && (
              <Button
                size="small"
                onClick={onToggle}
                startIcon={
                  resolved ? (
                    <ReplayIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <CheckIcon sx={{ fontSize: 16 }} />
                  )
                }
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
            )}
            {canManage && (
              <IconButton
                size="small"
                onClick={() => (confirm ? onDelete() : setConfirm(true))}
                onBlur={() => setConfirm(false)}
                title="Delete thread"
                sx={{
                  color: confirm ? 'error.contrastText' : 'text.secondary',
                  bgcolor: confirm ? 'error.main' : 'transparent',
                  '&:hover': {
                    bgcolor: confirm ? 'error.main' : tokens.muted,
                    color: 'text.primary',
                  },
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
            )}
          </>
        )}
      </Box>

      {blockedInfo && (
        <Box
          sx={{
            mx: 1.5,
            mt: 1.5,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.75,
            border: 1,
            borderColor: '#fcd34d',
            bgcolor: '#fef3c7',
            px: 1.25,
            py: 1,
            borderRadius: 1.5,
            fontSize: 12,
            lineHeight: 1.45,
            color: '#92400e',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 18, mt: '1px', color: '#d97706', flexShrink: 0 }} />
          <Typography variant="caption" sx={{ color: '#92400e' }}>
            {blockedHint(blockedInfo)}
          </Typography>
        </Box>
      )}

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', bgcolor: tokens.canvas, p: 1.5 }}>
        <Box
          sx={{ borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
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
            <Avatar
              sx={{
                width: 28,
                height: 28,
                fontSize: 12,
                bgcolor: userColor(comment.author_id || comment.author?.id || ''),
                color: '#fff',
              }}
            >
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
              {pageLabel(comment) && (
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
                  <FormatQuoteIcon sx={{ fontSize: 12 }} /> {pageLabel(comment)}
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
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center' }}
          >
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
