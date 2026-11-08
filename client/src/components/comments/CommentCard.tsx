import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, IconButton, Avatar, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ReplayIcon from '@mui/icons-material/Replay';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { Comment } from '../../api/types';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { displayName, timeAgo, pageLabel, blockedHint } from './utils';
import type { BlockedInfo } from './types';

export interface CommentCardProps {
  comment: Comment;
  index: number;
  active: boolean;
  canResolve: boolean;
  blockedInfo?: BlockedInfo;
  onOpen: () => void;
  onToggle: () => void;
}

function CommentCard({
  comment,
  index,
  active,
  canResolve,
  blockedInfo,
  onOpen,
  onToggle,
}: CommentCardProps) {
  const { t } = useTranslation();
  const { tokens } = useThemeMode();
  const resolved = comment.status === 'resolved';
  const name = displayName(t, comment);
  const replies = comment.replies ?? [];
  const last = replies[replies.length - 1];
  const people = Array.from(
    new Set([
      comment.author?.name || comment.author?.email || t('comments.anonymous'),
      ...replies.map((r) => displayName(t, r)),
    ]),
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
        bgcolor: tokens.surface,
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
          {timeAgo(t, comment.created_at)}
        </Typography>
        {blockedInfo && (
          <Tooltip title={blockedHint(t, blockedInfo)} arrow>
            <ErrorOutlineIcon sx={{ fontSize: 16, color: '#d97706', flexShrink: 0 }} />
          </Tooltip>
        )}
        {canResolve && (
          <IconButton
            size="small"
            className="resolve-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            title={resolved ? t('comments.reopen') : t('comments.resolve')}
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
        )}
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

      {blockedInfo && (
        <Box
          sx={{
            mt: 0.75,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.5,
            bgcolor: '#fef3c7',
            px: 0.75,
            py: 0.5,
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.4,
            color: '#92400e',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 14, mt: '1px', color: '#d97706', flexShrink: 0 }} />
          <Typography component="span" variant="caption" sx={{ color: '#92400e' }}>
            {blockedHint(t, blockedInfo)}
          </Typography>
        </Box>
      )}

      {pageLabel(t, comment) && (
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
            {pageLabel(t, comment)}
          </Typography>
        </Box>
      )}

      <Box
        display="flex"
        alignItems="center"
        gap={1}
        sx={{
          mt: 1,
          pt: 1,
          borderTop: 1,
          borderColor: 'divider',
          fontSize: 12,
          color: 'text.secondary',
        }}
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
              {t('comments.reply', { count: replies.length })}
            </Typography>
            <Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
              · {displayName(t, last)}: {last!.body}
            </Typography>
          </>
        ) : (
          <Typography variant="caption" sx={{ flexGrow: 1 }}>
            {t('comments.noReplies')}
          </Typography>
        )}
        <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
      </Box>
    </Box>
  );
}

export default memo(CommentCard);
