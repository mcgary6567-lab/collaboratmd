import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../e2e/helpers";

/**
 * Performance budgets for the screens people open most, on a production build.
 *
 * - JavaScript: compressed bytes of script downloaded to show the page. This is
 *   exact and the main thing that creeps up, so its budget is tight.
 * - Server time: time to the first byte of the page.
 * - LCP: when the largest thing on screen was drawn.
 * - CLS: how much the layout jumps while loading.
 *
 * Each page is opened once to warm up, then three times; the median counts.
 * Timing budgets are loose because shared CI machines are noisy; they catch a
 * page that became several times slower, not a few percent.
 */
type Budget = { path: string; signedIn: boolean; jsKb: number; serverMs: number; lcpMs: number };
const BUDGETS: Budget[] = [
  // JavaScript budgets are about 20% over what each page shipped on 2026-09-27.
  { path: "/", signedIn: false, jsKb: 175, serverMs: 1000, lcpMs: 2500 },
  { path: "/login", signedIn: false, jsKb: 165, serverMs: 1000, lcpMs: 2500 },
  { path: "/pricing", signedIn: false, jsKb: 170, serverMs: 1000, lcpMs: 2500 },
  { path: "/dashboard", signedIn: true, jsKb: 200, serverMs: 2000, lcpMs: 3000 },
  { path: "/claims", signedIn: true, jsKb: 200, serverMs: 2000, lcpMs: 3000 },
  { path: "/patients", signedIn: true, jsKb: 200, serverMs: 2000, lcpMs: 3000 },
  { path: "/scheduling", signedIn: true, jsKb: 200, serverMs: 2000, lcpMs: 3000 },
  { path: "/remittance", signedIn: true, jsKb: 200, serverMs: 2000, lcpMs: 3000 },
];
const CLS_MAX = 0.1;

type Sample = { jsBytes: number; serverMs: number; lcpMs: number; cls: number };

async function measure(page: Page, path: string): Promise<Sample> {
  const scripts: Promise<number>[] = [];
  const onResponse = (r: import("@playwright/test").Response) => {
    if (r.request().resourceType() === "script") scripts.push(r.request().sizes().then((s) => s.responseBodySize).catch(() => 0));
  };
  page.on("response", onResponse);
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  page.off("response", onResponse);
  const vitals = await page.evaluate(() => new Promise<{ serverMs: number; lcpMs: number; cls: number }>((resolve) => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    let lcp = 0;
    let cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    setTimeout(() => resolve({ serverMs: nav.responseStart - nav.requestStart, lcpMs: lcp, cls }), 500);
  }));
  const jsBytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
  return { jsBytes, ...vitals };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows: string[] = [];

for (const b of BUDGETS) {
  test(`budget: ${b.path}`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (b.signedIn) await signIn(page);
    await measure(page, b.path);
    const samples: Sample[] = [];
    // A fresh cache each time, so the JavaScript counted is what a first visit downloads.
    for (let i = 0; i < 3; i++) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.clearBrowserCache");
      await cdp.detach();
      samples.push(await measure(page, b.path));
    }
    await context.close();
    const m = { jsKb: median(samples.map((s) => s.jsBytes)) / 1024, serverMs: median(samples.map((s) => s.serverMs)), lcpMs: median(samples.map((s) => s.lcpMs)), cls: median(samples.map((s) => s.cls)) };
    const line = `| ${b.path} | ${m.jsKb.toFixed(0)} / ${b.jsKb} KB | ${m.serverMs.toFixed(0)} / ${b.serverMs} ms | ${m.lcpMs.toFixed(0)} / ${b.lcpMs} ms | ${m.cls.toFixed(3)} / ${CLS_MAX} |`;
    rows.push(line);
    console.log(line);
    expect.soft(m.jsKb, `${b.path}: JavaScript over budget`).toBeLessThanOrEqual(b.jsKb);
    expect.soft(m.serverMs, `${b.path}: server time over budget`).toBeLessThanOrEqual(b.serverMs);
    expect.soft(m.lcpMs, `${b.path}: largest paint over budget`).toBeLessThanOrEqual(b.lcpMs);
    expect.soft(m.cls, `${b.path}: layout shift over budget`).toBeLessThanOrEqual(CLS_MAX);
  });
}

test.afterAll(() => {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary && rows.length) fs.appendFileSync(summary, `### Performance (median of 3, measured / budget)\n\n| Page | JavaScript | Server | LCP | CLS |\n|---|---|---|---|---|\n${rows.join("\n")}\n`);
});
