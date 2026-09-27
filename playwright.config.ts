import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: the app in a real browser, against its own throwaway
 * embedded database (seeded with the demo data on first start), with no
 * clearinghouse, payment, texting, email or AI keys, so nothing leaves the
 * machine. Run with `npm run e2e`. Locally this uses the installed Edge
 * (E2E_CHANNEL=msedge); in CI install Chromium with `npx playwright install chromium`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3700);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // The dev server compiles each page on first visit, which can take longer than the 5 s default.
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "",
      PGLITE_DIR: ".e2e/pg",
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
      // The demo administrator can open the operator pages, so the accessibility crawl covers them.
      PLATFORM_ADMIN_EMAILS: "admin@collaboratmd.local",
      STEDI_API_KEY: "", STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", TWILIO_ACCOUNT_SID: "", ANTHROPIC_API_KEY: "",
    },
  },
});
