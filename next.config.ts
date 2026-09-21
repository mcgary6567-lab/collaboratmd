import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by the Next.js compiler.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "bcryptjs"],
};

export default nextConfig;
