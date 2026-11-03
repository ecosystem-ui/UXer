import { useState } from 'react';
import { Box, Typography, Button, TextField } from '@mui/material';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import { useThemeMode } from '../../theme/ThemeModeContext';

export interface NewCommentComposerProps {
  excerpt: string;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}

export default function NewCommentComposer({
  excerpt,
  onCancel,
  onSubmit,
}: NewCommentComposerProps) {
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
        <Button
          size="small"
          variant="contained"
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
        >
          Comment
        </Button>
      </Box>
    </Box>
  );
}
