import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The seeded demo administrator of the throwaway end-to-end database (see src/db/seed-data.ts). */
export const DEMO_ADMIN = { email: "admin@collaboratmd.local", password: "admin123" };

export async function signIn(page: Page, who = DEMO_ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first sign-in on a fresh server also seeds the demo data (and, on the dev server, compiles the dashboard).
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
  const wide = (await sidewaysOverflow(page)).map((c) => `${path}: wider than the screen: ${c}`);
  const squashed = (await squashedControls(page)).map((c) => `${path}: squashed control: ${c}`);
  const covered = (await coveredControls(page)).map((c) => `${path}: covered control: ${c}`);
  return [...axe, ...wide, ...squashed, ...covered];
}

/**
 * Dropdowns and text fields squeezed too narrow to show their choice or
 * placeholder (down to "Ca" for "Card", or just the arrow), buttons whose
 * label spills out of them, and controls reaching past their card. This
 * is the layout mistake a screenshot shows at a glance and the other checks
 * miss; it is checked directly because pixel comparisons would break every
 * day on the demo data's changing dates and totals.
 */
export async function squashedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const ctx = document.createElement("canvas").getContext("2d")!;
    const fields = "main input:is([type=text], [type=number], [type=email], [type=tel], [type=search], :not([type]))";
    for (const el of document.querySelectorAll<HTMLElement>(`main select, main button, main a.btn, ${fields}`)) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest("[aria-hidden='true'], [hidden], .sr-only, .hidden, details:not([open]) > :not(summary)")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // A control reaching past the edge of its card, over the card's border or the next card.
      const card = el.closest(".card")?.getBoundingClientRect();
      if (card && (r.right > card.right + 1 || r.left < card.left - 1) && !el.closest(".card .overflow-x-auto, .card .overflow-auto")) {
        out.push(`<${el.tagName.toLowerCase()}> "${(el instanceof HTMLSelectElement ? el.options[el.selectedIndex]?.text : el.getAttribute("placeholder") || el.innerText || el.getAttribute("name") || "")?.trim().slice(0, 30)}" reaches ${Math.round(Math.max(r.right - card.right, card.left - r.left))}px outside its card`);
      }
      if (el instanceof HTMLInputElement) {
        const text = (el.value || el.placeholder).trim();
        if (text.length < 2) continue;
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const need = ctx.measureText(text).width;
        // Number fields keep room for their up/down arrows.
        const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (el.type === "number" ? 16 : 0);
        if (room < Math.min(need, 40)) out.push(`<input> "${text.slice(0, 30)}" shows ${Math.max(0, Math.round(room))}px of ${Math.round(need)}px`);
      } else if (el instanceof HTMLSelectElement) {
        const text = el.options[el.selectedIndex]?.text.trim() ?? "";
        if (text.length < 2) continue;
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const need = ctx.measureText(text).width;
        // Room for the text: the box, less its padding and the arrow.
        const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 16;
        if (room < Math.min(need, 40)) out.push(`<select> "${text.slice(0, 30)}" shows ${Math.max(0, Math.round(room))}px of ${Math.round(need)}px`);
      } else if (el.scrollWidth > el.clientWidth + 2) {
        out.push(`<${el.tagName.toLowerCase()}> "${el.innerText.trim().slice(0, 30)}" label spills out (${el.scrollWidth}px in ${el.clientWidth}px)`);
      }
      if (out.length >= 5) break;
    }
    return out;
  });
}

/**
 * Whether the page scrolls sideways (on a phone, the whole page sliding left
 * and right), and if so the outermost elements that stick out past the screen.
 * Anything inside a container that scrolls or clips sideways is fine.
 */
export async function sidewaysOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return [];
    const contained = (e: Element) => {
      for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(n).overflowX)) return true;
      return false;
    };
    const out: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right <= width + 1 || r.width === 0 || contained(el)) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent.getBoundingClientRect().right > width + 1) continue; // report only the outermost
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".");
      out.push(`<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}> ${Math.round(r.right)}px wide on a ${width}px screen`);
      if (out.length >= 3) break;
    }
    return out.length ? out : [`page is ${document.documentElement.scrollWidth}px wide on a ${width}px screen`];
  });
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
