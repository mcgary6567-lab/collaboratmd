/**
 * Connection-string helpers.
 *
 * Kept free of server-only imports so they can be unit tested directly.
 */

/**
 * Whether a Postgres connection should negotiate TLS.
 *
 * Managed providers (Neon, Supabase, RDS) require it. A local server normally
 * speaks plaintext and refuses the TLS handshake, so forcing it there breaks
 * local development.
 */
export function needsSsl(url: string): boolean {
  if (/\bsslmode=(disable|allow)\b/.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** Connection pool sizing. Serverless instances are many and short-lived. */
export function poolSize(serverless: boolean): number {
  return serverless ? 1 : 10;
}
