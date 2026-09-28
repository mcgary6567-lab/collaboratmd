import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: the app in a real browser, against its own throwaway
 * embedded database (seeded with the demo data on first start), with no
 * clearinghouse, payment, texting, email or AI keys, so nothing leaves the
 * machine. Run with `npm run e2e`. Locally this uses the installed Edge
 * (E2E_CHANNEL=msedge); in CI install Chromium with `npx playwright install chromium`.
 *
 * The tests run against a production build (next build, then next start),
 * which is what patients get and does not compile pages on first visit.
 * E2E_DEV=1 uses the development server instead, for quick local runs.
 */
const PORT = Number(process.env.E2E_PORT ?? 3700);
const DEV = process.env.E2E_DEV === "1";
// Each run starts from an empty database (seeded again on first sign-in), so one run's leftovers
// (a restricted patient, a used link) cannot change the next. E2E_KEEP_DB=1 keeps it.
const FRESH_DB = process.env.E2E_KEEP_DB === "1" ? "" : `node -e "require('fs').rmSync('.e2e/pg',{recursive:true,force:true})" && `;
// The time-of-day CI job runs the server this many minutes ahead of the real clock, with
// libfaketime (Linux only), to try the app in the practice's morning, evening and after midnight.
// The embedded database runs inside the same process, so it sees the same time.
const OFFSET_MIN = process.env.E2E_CLOCK_OFFSET_MIN ? Math.round(Number(process.env.E2E_CLOCK_OFFSET_MIN)) : null;
const faked = (cmd: string) => (OFFSET_MIN === null ? cmd : `faketime -f "${OFFSET_MIN >= 0 ? "+" : ""}${OFFSET_MIN}m" ${cmd}`);

export default defineConfig({
  testDir: "e2e",
  // The dev server (E2E_DEV=1) compiles each page on first visit, so it needs far longer limits.
  timeout: DEV ? 240_000 : 90_000,
  expect: { timeout: DEV ? 45_000 : 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // In CI, failures also appear as annotations on the run, readable without downloading logs.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: FRESH_DB + (DEV ? faked(`npx next dev -p ${PORT}`) : `npx next build && ${faked(`npx next start -p ${PORT}`)}`),
    url: `http://localhost:${PORT}/api/health`,
    timeout: 600_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "",
      TZ: "UTC",
      // Production mode builds patient links from the configured address.
      APP_URL: `http://localhost:${PORT}`,
      PGLITE_DIR: ".e2e/pg",
      // Shift the wall clock only: timers and Node's own bookkeeping keep the real monotonic clock.
      FAKETIME_DONT_FAKE_MONOTONIC: "1",
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
      // The demo administrator can open the operator pages, so the accessibility crawl covers them.
      PLATFORM_ADMIN_EMAILS: "admin@collaboratmd.local",
      STEDI_API_KEY: "", STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", TWILIO_ACCOUNT_SID: "", ANTHROPIC_API_KEY: "",
    },
  },
});
