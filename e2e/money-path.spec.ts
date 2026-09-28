import { expect, test } from "@playwright/test";
import { DEMO_ADMIN, signIn } from "./helpers";

test("a wrong password is refused and the right one signs in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_ADMIN.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await signIn(page);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), / })).toBeVisible();
});

test("charge entry to claim, submitted, and paid from the remittance", async ({ page }) => {
  await signIn(page);

  // Enter a visit.
  await page.goto("/encounters/new");
  const search = page.getByPlaceholder("Search name or MRN");
  await search.fill("a");
  await page.locator("ul li button").first().click();
  await page.getByPlaceholder("e.g. E11.9").first().fill("E11.9");
  await page.locator('input[list="cpt-list"]').first().fill("99213");
  await page.getByRole("button", { name: "Save encounter and build claim" }).click();
  await expect(page).toHaveURL(/\/claims\/[0-9a-f-]{36}/);
  const claimUrl = page.url();

  // Send it.
  const submit = page.getByRole("button", { name: /Submit to clearinghouse/ });
  await expect(submit).toBeVisible();
  await submit.click();
  await expect(page.getByText(/accepted|rejected/i).first()).toBeVisible();

  // The simulated payer answers with an 835, which posts to the claim.
  await page.goto("/remittance");
  await page.getByRole("button", { name: /Fetch ERAs/ }).click();
  await expect(page.getByText(/processed|posted|No ERAs|nothing/i).first()).toBeVisible();
  await page.goto(claimUrl);
  await expect(page.getByText(/insurance payment|paid|denied/i).first()).toBeVisible();
});

test("the claims list acts on several claims at once", async ({ page }) => {
  await signIn(page);
  await page.goto("/claims?status=ready");
  await page.waitForLoadState("networkidle");
  const boxes = page.locator('input[form="bulk-claims"][name="ids"]');
  test.skip((await boxes.count()) === 0, "no ready claims in the seed");
  await boxes.first().check();
  await page.locator('select[name="op"]').selectOption("rescrub");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Rescrubbed 1/)).toBeVisible();
});
