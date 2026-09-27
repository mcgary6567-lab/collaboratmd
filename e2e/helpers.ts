import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The seeded demo administrator of the throwaway end-to-end database (see src/db/seed-data.ts). */
export const DEMO_ADMIN = { email: "admin@collaboratmd.local", password: "admin123" };

export async function signIn(page: Page, who = DEMO_ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first sign-in on a fresh server also compiles the dashboard, which can take a minute.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 120_000 });
}

/** Opens a page and lists its serious and critical WCAG 2.1 A/AA problems (or a server error). */
export async function check(page: Page, path: string) {
  const res = await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const status = res?.status() ?? 0;
  if (status >= 500) return [`${path}: HTTP ${status}`];
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
}
