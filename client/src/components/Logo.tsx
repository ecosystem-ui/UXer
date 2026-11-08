import { Box } from '@mui/material';

export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      className="uxer-logo"
      sx={{ width: size, height: size, borderRadius: `${Math.round(size * 0.31)}px` }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 4.2v9a5 5 0 0 0 10 0v-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </Box>
  );
}
