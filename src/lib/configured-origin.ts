/**
 * The site's address from configuration only (never from a request's Host
 * header): APP_URL, then Vercel's production domain. Null when neither is set
 * (local runs, tests). See also lib/origin.ts, which falls back to the request
 * in development.
 */
export function configuredOrigin() {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
}

/** Where Twilio reports whether a practice's text reached the phone; null when the site has no public address. */
export function deliveryCallbackUrl(practiceId: string) {
  const origin = configuredOrigin();
  return origin && !/localhost|127\.0\.0\.1/.test(origin) ? `${origin}/api/twilio/status/${practiceId}` : null;
}
