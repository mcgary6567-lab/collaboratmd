import { defineConfig } from "@playwright/test";

/**
 * Performance budgets, measured on a production build (`next build` first),
 * against its own throwaway embedded database seeded with the demo practice.
 * Run with `npm run perf`. See e2e-perf/budgets.spec.ts for what is measured.
 */
const PORT = Number(process.env.PERF_PORT ?? 3710);

export default defineConfig({
  testDir: "e2e-perf",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL || undefined,
    viewport: { width: 1366, height: 900 },
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "",
      PGLITE_DIR: ".e2e/perf-pg",
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
      STEDI_API_KEY: "", STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", TWILIO_ACCOUNT_SID: "", ANTHROPIC_API_KEY: "",
    },
  },
});
