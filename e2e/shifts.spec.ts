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

test("a biller submits the week and asks for a correction; an administrator approves both", async ({ browser }) => {
  const biller = await demo(browser, "biller");
  await biller.goto("/work/shifts");
  const shift = biller.locator("section.card").filter({ has: biller.getByRole("heading", { name: "Your shift" }) });
  await shift.getByRole("button", { name: "Clock in" }).click();
  await expect(shift.getByRole("button", { name: "Clock out" })).toBeVisible({ timeout: 30_000 });
  await shift.getByRole("button", { name: "Clock out" }).click();
  await expect(shift.getByRole("button", { name: "Clock in" })).toBeVisible({ timeout: 30_000 });

  const sheet = biller.locator("section.card").filter({ has: biller.getByRole("heading", { name: "Your timesheet" }) });
  await sheet.getByRole("button", { name: "Submit the week" }).last().click();
  await expect(sheet.getByText("submitted", { exact: true })).toBeVisible({ timeout: 30_000 });
  await sheet.getByLabel("Entry").selectOption({ label: "A shift I did not clock (add it)" });
  await sheet.getByLabel("Clock-in (your time)").fill("2026-09-21T09:00");
  await sheet.getByLabel("Clock-out (your time)").fill("2026-09-21T17:00");
  await sheet.getByLabel("Reason").fill("Forgot to clock in on Monday");
  await sheet.getByRole("button", { name: "Ask for the correction" }).click();
  await expect(sheet.getByText("Forgot to clock in on Monday")).toBeVisible({ timeout: 30_000 });

  const admin = await demo(browser, "administrator");
  await admin.goto("/work/shifts/timesheets");
  const correction = admin.getByRole("listitem").filter({ hasText: "Forgot to clock in on Monday" });
  await correction.getByRole("button", { name: "Approve" }).click();
  await expect(correction).toHaveCount(0, { timeout: 30_000 });
  const week = admin.getByRole("listitem").filter({ hasText: "Jordan Lee, week of" });
  await week.getByRole("button", { name: "Approve" }).click();
  await expect(week).toHaveCount(0, { timeout: 30_000 });

  await admin.goto("/work/shifts/timesheets?week=2026-09-21");
  await admin.getByLabel("Person").selectOption({ label: "Jordan Lee" });
  await admin.getByRole("button", { name: "Show" }).click();
  await expect(admin.getByText(/8\.00 hours worked/)).toBeVisible({ timeout: 30_000 });

  await biller.context().close();
  await admin.context().close();
});

test("the team week and the payroll file", async ({ browser }) => {
  const admin = await demo(browser, "administrator");
  await admin.goto("/work/shifts/week");
  await expect(admin.getByRole("heading", { name: "Team week" })).toBeVisible();
  await expect(admin.getByRole("region", { name: "Shifts by person and day" })).toContainText("Jordan Lee");
  const csv = await admin.request.get("/api/export/payroll?from=2026-09-21&to=2026-09-27");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toMatch(/^Person,Time zone,From,To,Hours/);
  await admin.context().close();
});

test("an open shift is posted, claimed and confirmed", async ({ browser }) => {
  const admin = await demo(browser, "administrator");
  await admin.goto("/work/shifts/week");
  const card = admin.locator("section.card").filter({ has: admin.getByRole("heading", { name: "Open shifts" }) });
  await card.getByLabel("Note").fill("E2E night cover");
  await card.getByRole("button", { name: "Post the shift" }).click();
  await expect(card.getByRole("listitem").filter({ hasText: "E2E night cover" })).toBeVisible({ timeout: 30_000 });

  const biller = await demo(browser, "biller");
  await biller.goto("/work/shifts/week");
  const offer = biller.getByRole("listitem").filter({ hasText: "E2E night cover" });
  await offer.getByRole("button", { name: "Claim" }).click();
  await expect(offer).toContainText("claimed by Jordan Lee", { timeout: 30_000 });

  await admin.reload();
  const claimed = admin.getByRole("listitem").filter({ hasText: "E2E night cover" });
  await claimed.getByRole("button", { name: "Confirm" }).click();
  await expect(claimed.getByRole("button", { name: "Confirm" })).toHaveCount(0, { timeout: 30_000 });
  await expect(claimed).toContainText("Jordan Lee");
  await biller.context().close();
  await admin.context().close();
});

test("a biller asks for a morning off and signs for HIPAA training", async ({ browser }) => {
  const biller = await demo(browser, "biller");
  await biller.goto("/work/shifts");
  await biller.getByLabel("First day off (your date)").fill("2031-02-03");
  await biller.getByLabel("Last day off").fill("2031-02-03");
  await biller.getByLabel("How much").selectOption({ label: "Morning" });
  await biller.getByRole("button", { name: "Ask for time off" }).click();
  const req = biller.getByRole("listitem").filter({ hasText: "(morning)" });
  await expect(req).toBeVisible({ timeout: 30_000 });
  await req.getByRole("button", { name: "Cancel" }).click();
  await expect(req).toHaveCount(0, { timeout: 30_000 });

  await biller.goto("/work/training");
  const mine = biller.locator("section.card").filter({ has: biller.getByRole("heading", { name: "Yours" }) });
  await mine.getByRole("button", { name: "Sign and save" }).click();
  await expect(mine.getByText("current", { exact: true })).toBeVisible({ timeout: 30_000 });
  await biller.context().close();
});
