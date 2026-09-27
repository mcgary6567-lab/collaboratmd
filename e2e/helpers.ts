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

/**
 * Opens a page and lists its serious and critical WCAG 2.1 A/AA problems, any
 * control that something else covers, or a server error.
 */
export async function check(page: Page, path: string) {
  const res = await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const status = res?.status() ?? 0;
  if (status >= 500) return [`${path}: HTTP ${status}`];
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const axe = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  const covered = (await coveredControls(page)).map((c) => `${path}: covered control: ${c}`);
  return [...axe, ...covered];
}

/**
 * Buttons, links and fields that cannot be clicked because something else sits
 * on top of them (a card that slid under its neighbour, say). Each is scrolled
 * into view and checked at its centre. Things fixed to the screen (headers, the
 * help button) are left out, as are controls hidden, clipped or off screen.
 */
export async function coveredControls(page: Page): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const name = (e: Element) => {
      const text = (e.getAttribute("aria-label") || (e as HTMLElement).innerText || e.getAttribute("placeholder") || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}>${text ? ` "${text}"` : ""}`;
    };
    const pinned = (e: Element | null) => {
      for (let n = e; n; n = n.parentElement) if (["fixed", "sticky"].includes(getComputedStyle(n).position)) return true;
      return false;
    };
    const controls = [...document.querySelectorAll("main a[href], main button, main input:not([type=hidden]), main select, main textarea")].slice(0, 400);
    for (const el of controls) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.pointerEvents === "none" || el.closest("[aria-hidden='true'], [hidden], .sr-only, .hidden")) continue;
      // Inside a closed <details> (other than its summary) nothing is drawn, though the browser may still report a size.
      const closed = el.closest("details:not([open])");
      if (closed && !el.closest("summary")?.parentElement?.isSameNode(closed)) continue;
      const before = el.getBoundingClientRect();
      if (before.width < 4 || before.height < 4) continue;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || el === hit || el.contains(hit) || hit.contains(el)) continue;
      const labels = (el as HTMLInputElement).labels;
      if (labels && [...labels].some((l) => l.contains(hit))) continue;
      if (pinned(hit)) continue;
      out.push(`${name(el)} under ${name(hit)}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
  return [...new Set(found)].slice(0, 5);
}
