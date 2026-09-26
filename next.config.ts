import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by the Next.js compiler.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "bcryptjs"],
  // Defense in depth: environment files are read at build time and injected as
  // values, so they must never be traced into a deployed function bundle,
  // which would ship the database credentials and session key as files.
  // Note this does not catch every case - the reliable guarantee is that no
  // .env file exists on disk during a production build, which is how Vercel
  // builds work (values come from project settings, not files).
  outputFileTracingExcludes: {
    "*": ["**/.env*", "data/**", "docs/**", "scripts/**"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nothing here is meant to be shown inside another site's frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // These addresses carry a secret token; send no referrer at all from them.
        source: "/:area(portal|reset|check-in|welcome|unsubscribe|signup)/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  experimental: {
    // Patient imports send the CSV to a server action. 4 MB fits the
    // 5,000-row import limit and stays under Vercel's 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
