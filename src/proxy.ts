import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { THEME_SCRIPT } from "@/lib/theme-script";

/** The one inline script of our own (the theme switch before first paint), allowed by its hash. */
const THEME_HASH = `'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`;

/**
 * A strict Content-Security-Policy for every server-rendered page: scripts run
 * only if they carry this request's nonce (Next.js adds it to its own), so an
 * injected <script> or an inline event handler does nothing. Styles allow
 * inline attributes, which charts and layout use; that is the part left open.
 *
 * Every page is rendered per request (including the 404 page, see
 * app/not-found.tsx), which a nonce needs; a page built ahead of time would
 * have its scripts blocked. Keep it that way, or leave such a page out of the
 * matcher below.
 */
export function proxy(request: NextRequest) {
  // Every request gets an id, returned as X-Request-Id and kept with any error it causes, to find it in the logs.
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("X-Request-Id", requestId);
    return res;
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    // React uses eval only in development, for readable server error stacks.
    `script-src 'self' 'nonce-${nonce}' ${THEME_HASH} 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ...(request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  matcher: [
    {
      // Not build assets, icons or the service worker. API routes get a request id but no CSP (see above).
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|pwa-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
