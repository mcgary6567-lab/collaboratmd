import { expect, test, type Browser, type Page } from "@playwright/test";

async function demo(browser: Browser, who: "administrator" | "biller"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/demo");
  await page.getByRole("button", { name: `Try as ${who}` }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 120_000 });
  return page;
}

test("clock in, take a break and clock out", async ({ browser }) => {
  const page = await demo(browser, "administrator");
  await page.goto("/work/shifts");
  const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Your shift" }) });
  await card.getByRole("button", { name: "Clock in" }).click();
  await expect(card.getByRole("button", { name: "Start break" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Start break" }).click();
  await expect(card.getByRole("button", { name: "End break" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "End break" }).click();
  await expect(card.getByRole("button", { name: "Start break" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Clock out" }).click();
  await expect(card.getByRole("button", { name: "Clock in" })).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});

test("a biller asks for time off and an administrator approves, then cancels it", async ({ browser }) => {
  const biller = await demo(browser, "biller");
  await biller.goto("/work/shifts");
  await biller.getByLabel("First day off (your date)").fill("2031-01-06");
  await biller.getByLabel("Last day off").fill("2031-01-07");
  await biller.getByRole("button", { name: "Ask for time off" }).click();
  await expect(biller.getByText("waiting for approval").first()).toBeVisible({ timeout: 30_000 });

  const admin = await demo(browser, "administrator");
  await admin.goto("/work/shifts/manage");
  const request = admin.getByRole("listitem").filter({ hasText: "Jordan Lee" }).filter({ hasText: "2031" });
  await request.getByRole("button", { name: "Approve" }).click();
  const approved = admin.getByRole("listitem").filter({ hasText: "Jordan Lee" }).filter({ hasText: "2031" }).filter({ has: admin.getByRole("button", { name: "Cancel" }) });
  await expect(approved).toBeVisible({ timeout: 30_000 });
  await approved.getByRole("button", { name: "Cancel" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: "Jordan Lee" }).filter({ hasText: "2031" })).toHaveCount(0, { timeout: 30_000 });

  await biller.context().close();
  await admin.context().close();
});
