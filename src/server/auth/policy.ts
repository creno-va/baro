export const SESSION_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_SECONDS = 24 * 60 * 60;
export const RECENT_OAUTH_MS = 10 * 60 * 1_000;
// Daily cleanup removes records at 29 days, leaving one day below the 30-day ceiling.
export const AUTH_RETENTION_MS = 29 * 24 * 60 * 60 * 1_000;

export function hasRecentOAuthAuthentication(
  session: { oauthAuthenticatedAt?: Date | null | undefined; expiresAt: Date } | null,
  now = Date.now(),
): boolean {
  if (!session?.oauthAuthenticatedAt) return false;
  const expiresAt = session.expiresAt.getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const age = now - session.oauthAuthenticatedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age <= RECENT_OAUTH_MS;
}
