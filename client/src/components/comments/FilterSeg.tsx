import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useThemeMode } from '../../theme/ThemeModeContext';
import type { Filter } from './types';

export interface FilterSegProps {
  value: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}

export default function FilterSeg({ value, onChange, counts }: FilterSegProps) {
  const { t } = useTranslation();
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
            bgcolor: value === f ? tokens.surface : 'transparent',
            boxShadow: value === f ? '0 1px 2px rgba(2, 6, 24, 0.08)' : 'none',
            transition: 'all .15s ease',
            '&:hover': value !== f ? { color: tokens.foreground } : {},
          }}
        >
          {t(`filters.${f}`)}{' '}
          <Box component="span" sx={{ fontSize: 12, opacity: 0.7 }}>
            {counts[f]}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
