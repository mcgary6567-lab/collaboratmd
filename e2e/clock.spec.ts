import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * "Today" is the practice's today. The time-of-day CI job runs this with the
 * server's clock shifted (E2E_CLOCK_OFFSET_MIN, see playwright.config.ts) into
 * the practice's morning, its evening (when UTC is already on the next day)
 * and just after its midnight; normally it runs at whatever time it is.
 */
const offsetMs = Number(process.env.E2E_CLOCK_OFFSET_MIN ?? 0) * 60_000;
const ZONE = "America/New_York"; // the demo practice's time zone

const practiceDay = (plusDays = 0) =>
  new Date(Date.now() + offsetMs + plusDays * 86_400_000).toLocaleDateString("en-US", { timeZone: ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" });

test("the schedule opens on the practice's today, with the day's appointments", async ({ page }) => {
  await signIn(page);
  await page.goto("/scheduling");
  // Allow for the run crossing midnight between reading the clock and loading the page.
  await expect(page.getByText(new RegExp(`^(${practiceDay()}|${practiceDay(1)})$`))).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Appointments \([1-9]\d*\)$/ })).toBeVisible();
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(/\/scheduling\?date=/);
  await expect(page.getByRole("heading", { name: /^Appointments \([1-9]\d*\)$/ })).toBeVisible();
});
