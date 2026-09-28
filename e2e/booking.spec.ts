import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("a patient requests a time online and the front desk confirms it", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/settings/booking");
  await page.getByLabel("Accept online requests").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();

  // The first provider takes bookings every day, all day, so there is always an open time tomorrow.
  const firstHours = page.locator("form").filter({ has: page.getByRole("button", { name: "Save hours" }) }).first();
  for (let d = 0; d < 7; d++) {
    await firstHours.locator(`input[name="start_${d}"]`).fill("08:00");
    await firstHours.locator(`input[name="end_${d}"]`).fill("17:00");
  }
  await firstHours.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved").first()).toBeVisible();
  await page.reload();
  const link = (await page.locator("code").filter({ hasText: "/book/" }).first().textContent())!.trim();

  // The patient's side, with no staff session.
  const patient = await browser.newContext();
  const p = await patient.newPage();
  await p.goto(new URL(new URL(link).pathname, page.url()).toString());
  const results = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await p.locator('a[href*="start="]').first().click();
  await p.getByLabel("First name").fill("Online");
  await p.getByLabel("Last name").fill(`Booker${Date.now() % 100000}`);
  await p.getByLabel("Date of birth").fill("1985-06-15");
  await p.getByLabel("Email").fill("online.booker@example.test");
  await p.getByRole("button", { name: /^Request / }).click();
  await expect(p.getByText(/Request sent for/).first()).toBeVisible();
  await patient.close();

  await page.goto("/scheduling");
  await expect(page.getByText(/Online requests waiting/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).first().click();
  await expect(page.getByText(/booked with a new patient record/).first()).toBeVisible();

  // "No time that suits?": asks to join the waitlist, and the front desk confirms it the same way.
  const other = await browser.newContext();
  const q = await other.newPage();
  await q.goto(new URL(new URL(link).pathname, page.url()).toString());
  await q.getByText("No time that suits?").click();
  const ask = q.locator("form").filter({ has: q.getByRole("button", { name: "Ask to join the waitlist" }) });
  const last = `Waiter${Date.now() % 100000}`;
  await ask.getByLabel("First name").fill("Online");
  await ask.getByLabel("Last name").fill(last);
  await ask.getByLabel("Date of birth").fill("1979-03-04");
  await ask.getByLabel("Mobile phone").fill("555-010-7777");
  await ask.getByLabel("When you can come").selectOption("morning");
  await ask.getByRole("checkbox").check();
  await ask.getByRole("button", { name: "Ask to join the waitlist" }).click();
  await expect(q.getByText("Request sent")).toBeVisible();
  await other.close();

  await page.goto("/scheduling");
  const request = page.locator("li").filter({ hasText: "Wants to join the waitlist" }).filter({ hasText: last });
  await expect(request).toContainText("before noon");
  await request.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Added to the waitlist with a new patient record/)).toBeVisible();
  await expect(page.locator("li").filter({ hasText: last }).filter({ hasText: "before noon" }).first()).toBeVisible();
});
