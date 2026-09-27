import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Every screen, checked for serious and critical WCAG 2.1 A/AA problems.
 * Starts from the fixed list below, then follows the links it finds so pages
 * with an id in the address (a patient, a claim, a statement) are covered by
 * one example each. Pages that act on a token in the address are left out.
 */
const APP = [
  "/dashboard", "/work", "/tasks", "/notifications", "/messages", "/welcome", "/setup",
  "/patients", "/patients/new", "/patients/coverage-discovery", "/check-ins", "/scheduling", "/scheduling/estimates", "/estimates/new",
  "/encounters/new", "/encounters/dental", "/encounters/institutional", "/coding", "/labs", "/import",
  "/claims", "/claims/follow-up", "/denials", "/denials/agent", "/remittance", "/remittance/deposits", "/underpayments",
  "/billing", "/billing/accounting", "/billing/collections", "/billing/credits", "/billing/legacy", "/billing/missed-charges",
  "/reports", "/reports/builder", "/reports/forecast", "/reports/locations", "/reports/payer-alerts",
  "/clients", "/clients/invoicing", "/admin", "/ops/errors", "/ops/feedback", "/ops/practices",
  "/settings", "/settings/audit", "/settings/automation", "/settings/booking", "/settings/close", "/settings/code-sets", "/settings/compliance",
  "/settings/connections", "/settings/connections/doctor", "/settings/credentials", "/settings/data-export", "/settings/developers",
  "/settings/enrollment", "/settings/fees", "/settings/fhir", "/settings/go-live", "/settings/integrations", "/settings/locations", "/settings/menu",
  "/settings/payer-edits", "/settings/payers", "/settings/policies", "/settings/profile", "/settings/providers", "/settings/security",
  "/settings/sso", "/settings/subscription", "/settings/team",
];
const PUBLIC = [
  "/", "/about", "/pricing", "/security", "/trust", "/privacy", "/terms", "/gdpr", "/contact", "/status", "/switch", "/changelog",
  "/blog", "/investors", "/login", "/login/forgot", "/login/sso", "/signup", "/offline",
];
const SKIP = /^\/(api|portal|check-in|reset|unsubscribe|logout|login\/verify|signup\/verify)(\/|$)/;
const pattern = (path: string) => path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:n");

async function check(page: Page, path: string) {
  const res = await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const status = res?.status() ?? 0;
  if (status >= 500) return [`${path}: HTTP ${status}`];
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
}

async function links(page: Page) {
  const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
  return hrefs.map((h) => h.split(/[?#]/)[0]).filter((h) => h && !SKIP.test(h));
}

test("accessibility: every signed-in screen", async ({ page }) => {
  test.setTimeout(60 * 60_000);
  await signIn(page);
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = [...APP];
  const found: string[] = [];
  for (let path = queue.shift(); path; path = queue.shift()) {
    const key = pattern(path);
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(...(await check(page, path)));
    // Pages reached from a claim by buttons rather than links.
    if (/^\/claims\/[0-9a-f-]{36}$/.test(path)) queue.push(`${path}/edit`, `${path}/cover`);
    for (const l of await links(page)) if (!seen.has(pattern(l)) && !PUBLIC.includes(l) && !found.includes(l)) { found.push(l); queue.push(l); }
    if (seen.size > 160) break;
  }
  console.log(`checked ${seen.size} signed-in screens: ${[...seen].join(" ")}`);
  expect(problems).toEqual([]);
});

test("accessibility: every public page", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const problems: string[] = [];
  for (const path of PUBLIC) problems.push(...(await check(page, path)));
  // One blog post, found from the index.
  await page.goto("/blog");
  const post = await page.locator("a[href^='/blog/']").first().getAttribute("href").catch(() => null);
  if (post) problems.push(...(await check(page, post)));
  expect(problems).toEqual([]);
});
