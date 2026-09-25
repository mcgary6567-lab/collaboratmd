/**
 * Key used to sign session tokens.
 *
 * Falls back to a fixed development value only outside production. A deployed
 * app running on a published default would let anyone forge a session, so
 * production refuses to start a session without AUTH_SECRET.
 */
export const appSecret = (): Uint8Array => {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 32");
  }
  return new TextEncoder().encode("dev-only-secret-change-me-please-0123456789");
};
