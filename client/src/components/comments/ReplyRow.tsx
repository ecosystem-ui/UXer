import { Box, Avatar, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Reply } from '../../api/types';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { displayName, userColor, timeAgo } from './utils';

export interface ReplyRowProps {
  reply: Reply;
}

export default function ReplyRow({ reply }: ReplyRowProps) {
  const { t } = useTranslation();
  const { tokens } = useThemeMode();
  const name = displayName(t, reply);
  return (
    <Box className="reply-row" sx={{ position: 'relative', display: 'flex', gap: 1.25 }}>
      <Avatar
        sx={{
          zIndex: 1,
          width: 20,
          height: 20,
          fontSize: 10,
          bgcolor: userColor(reply.author_id || reply.author?.id || ''),
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
            {timeAgo(t, reply.created_at)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {reply.body}
        </Typography>
      </Box>
    </Box>
  );
}
