// Post-login navigation helpers.
//
// Shared links point straight at a project or a persona preview. When the
// visitor has no session, the requested location travels through the login
// page as a `next` query parameter so sign-in can return them to it.

export const HOME_PATH = '/';

const AUTH_PATHS = ['/login', '/reset-password'];

/** Build the login location that returns to `from` once the user signs in. */
export function loginPathFor(from: string): string {
  return `/login?next=${encodeURIComponent(from)}`;
}

/**
 * Resolve a `next` value to a same-origin absolute path. Anything that could
 * leave the app (absolute or protocol-relative URLs) or bounce back to an auth
 * page resolves to the home page instead.
 */
export function resolveNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return HOME_PATH;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return HOME_PATH;

  const path = raw.split(/[?#]/, 1)[0];
  if (AUTH_PATHS.includes(path)) return HOME_PATH;
  return raw;
}
