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
};

export default nextConfig;
