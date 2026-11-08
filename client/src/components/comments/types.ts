export type Filter = 'open' | 'resolved' | 'all';
export type Sort = 'newest' | 'oldest';
export const MAX_MESSAGE_LENGTH = 500;

// A comment can't be navigated to automatically because the wizard is gated
// by required fields / validation. This records why so the UI can guide the
// reviewer to the right step manually.
export type BlockedInfo = { stepLabel?: string; reason?: string };
