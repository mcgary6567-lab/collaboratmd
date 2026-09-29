import { expect, test, type Page } from "@playwright/test";
import { check, DEMO_ADMIN, signIn } from "./helpers";

/**
 * Accessibility of the screens that only exist once there is a record to show:
 * a statement, an estimate, a fee schedule, a client invoice,
 * and the patient's own portal and check-in pages. Each record is made the way
 * staff make it, then its page is checked. This file runs last (by name), so
 * the records it creates do not change what the other end-to-end tests see.
 *
 * Lab results, underpayment letters and final notices need an imported lab
 * file, a paid claim under a payer contract, or statements at least 60 days
 * old; they are checked when the data has them.
 */
const ID = "[0-9a-f-]{36}";

async function firstHref(page: Page, path: string, pattern: RegExp) {
  await page.goto(path);
  const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
  return hrefs.find((h) => pattern.test(h)) ?? null;
}

test("accessibility: screens for individual records", async ({ page, browser }) => {
  test.setTimeout(20 * 60_000);
  await signIn(page);
  const pages: string[] = [];
  const missing: string[] = [];
  const want = async (label: string, href: string | null) => (href ? pages.push(href) : missing.push(label));

  // A statement, from Billing.
  await page.goto("/billing");
  await page.getByRole("button", { name: "Generate statements" }).click();
  await expect(page.locator(`a[href^='/statements/']`).first()).toBeVisible();
  await want("statement", await firstHref(page, "/billing", new RegExp(`^/statements/${ID}$`)));

  // A fee schedule, from Settings.
  await page.goto("/settings/fees");
  const createStandard = page.getByRole("button", { name: "Create standard schedule" });
  await expect(createStandard.or(page.locator("a[href^='/settings/fees/']")).first()).toBeVisible({ timeout: 30_000 });
  if (await createStandard.isVisible()) {
    await createStandard.click();
    // Creating it opens the new schedule.
    await page.waitForURL(new RegExp(`/settings/fees/${ID}$`));
  }
  await want("fee schedule", await firstHref(page, "/settings/fees", new RegExp(`^/settings/fees/${ID}$`)));

  // An estimate for the first patient.
  const patient = await firstHref(page, "/patients", new RegExp(`^/patients/${ID}$`));
  expect(patient).not.toBeNull();
  await page.goto(`/estimates/new?patientId=${patient!.split("/")[2]}`);
  const cpt = page.locator('select[name="cpt"]').first();
  await cpt.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create estimate" }).click();
  await page.waitForURL(new RegExp(`/estimates/${ID}`), { timeout: 45_000 }).catch(() => undefined);
  await want("estimate", new RegExp(`/estimates/${ID}$`).test(new URL(page.url()).pathname) ? new URL(page.url()).pathname : await firstHref(page, patient!, new RegExp(`^/estimates/${ID}$`)));

  // A client invoice: agree terms with the practice, then invoice last month.
  await page.goto("/clients/invoicing");
  const invoiceLink = page.locator("a[href^='/clients/invoicing/']").first();
  const invoice = page.getByRole("button", { name: /^Invoice / }).first();
  const issuer = page.locator('input[name="issuerName"]').first();
  // The page streams in behind a loading state: wait for the terms form, the invoice button or an invoice.
  await expect(issuer.or(invoice).or(invoiceLink).first()).toBeVisible({ timeout: 30_000 });
  if (await issuer.isVisible()) {
    await issuer.fill("Accessibility Test Billing LLC");
    await page.locator('input[name="ratePct"]').first().fill("6.5");
    await page.getByRole("button", { name: "Save agreement" }).first().click();
    // Saving the terms is what brings up the invoice button.
    await expect(invoice).toBeVisible();
  }
  if (await invoice.isVisible()) {
    await invoice.click();
    await expect(invoiceLink).toBeVisible();
  }
  await want("client invoice", await firstHref(page, "/clients/invoicing", new RegExp(`^/clients/invoicing/${ID}$`)));

  // Present only when the data has them.
  await want("final notice", await firstHref(page, "/billing/collections", new RegExp(`^/billing/collections/${ID}/notice$`)));
  await want("lab result", await firstHref(page, "/labs", new RegExp(`^/labs/${ID}$`)));
  await want("underpayment letter", await firstHref(page, "/underpayments", new RegExp(`^/underpayments/letter/${ID}$`)));

  // The printable pages for a paid claim: its EOB from the 835, and its timely filing record.
  const paidClaim = await firstHref(page, "/claims?status=paid", new RegExp(`^/claims/${ID}$`));
  await want("paid claim", paidClaim);
  if (paidClaim) pages.push(paidClaim.replace("/claims/", "/print/eob/"), paidClaim.replace("/claims/", "/print/timely-filing/"));

  const problems: string[] = [];
  for (const p of pages) problems.push(...(await check(page, p)));

  // A restricted record: opening it asks for a reason first, then opens.
  const gate = page.getByRole("heading", { name: "Restricted record" });
  await page.goto(patient!);
  await expect(gate.or(page.getByRole("button", { name: "Restrict", exact: true }))).toBeVisible({ timeout: 30_000 });
  if (await gate.isVisible()) {
    // Left restricted by an earlier attempt (a retry, or a kept local database): open it and lift that first.
    await page.getByLabel("Reason").fill("Undoing the restriction an earlier test run left");
    await page.getByLabel("Your password").fill(DEMO_ADMIN.password);
    await page.getByRole("button", { name: "Open the record" }).click();
    await page.getByRole("button", { name: "Remove restriction" }).click();
    await expect(page.getByRole("button", { name: "Restrict", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Restrict", exact: true }).click();
  // Restricting asks everyone for a reason, the administrator who did it included: the page turns into the gate.
  await expect(gate).toBeVisible();
  problems.push(...(await check(page, patient!)).map((x) => `${x} (restricted record gate)`));
  await page.getByLabel("Reason").fill("Checking the gate works in the accessibility test");
  await page.getByLabel("Your password").fill(DEMO_ADMIN.password);
  await page.getByRole("button", { name: "Open the record" }).click();
  await expect(page.getByRole("button", { name: "Remove restriction" })).toBeVisible();
  await page.getByRole("button", { name: "Remove restriction" }).click();
  await expect(page.getByRole("button", { name: "Restrict", exact: true })).toBeVisible();

  // The patient's side: a portal link and a check-in link, opened without a staff session.
  await page.goto(patient!);
  await page.getByRole("button", { name: "Send portal link" }).click();
  const portalField = page.locator('input[readonly][value*="/portal/"]');
  await expect(portalField).toBeVisible();
  const portalPath = new URL(await portalField.inputValue()).pathname;
  // Tomorrow's schedule: late in the practice's evening, this morning's visits are past their check-in window.
  await page.goto("/scheduling");
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(/\/scheduling\?date=/);
  await page.locator("button[title^='Create a link the patient uses to check in']").first().click();
  const checkinField = page.locator('input[readonly][value*="/check-in/"]').first();
  await expect(checkinField).toBeVisible();
  const checkinPath = new URL(await checkinField.inputValue()).pathname;
  const anonymous = await browser.newContext();
  const p = await anonymous.newPage();
  for (const path of [portalPath, checkinPath]) problems.push(...(await check(p, path)).map((x) => x.replace(/[A-Za-z0-9_-]{20,}/g, ":token")));
  await anonymous.close();

  console.log(`checked ${pages.length + 2} record screens; not in this data: ${missing.join(", ") || "none"}`);
  expect(missing.filter((m) => !["lab result", "underpayment letter", "final notice"].includes(m))).toEqual([]);
  expect(problems).toEqual([]);
});
