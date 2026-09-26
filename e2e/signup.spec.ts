import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the signup form checks its fields and says so when the confirmation email cannot go out", async ({ page }) => {
  await page.goto("/signup?plan=professional");
  await expect(page.getByRole("heading", { name: "Start your free trial" })).toBeVisible();
  await expect(page.locator('select[name="plan"]')).toHaveValue("professional");

  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Work email").fill(`signup-${Date.now()}@example.test`);
  await page.getByLabel("Practice or billing company name").fill("Test Clinic");
  await page.getByLabel(/^Password/).fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Start the \d+-day trial/ }).click();
  // The end-to-end server has no email provider, so the honest answer is that nothing was sent.
  await expect(page.getByText(/could not send the confirmation email/)).toBeVisible();
});

test("accessibility: /signup", async ({ page }) => {
  await page.goto("/signup");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
});
