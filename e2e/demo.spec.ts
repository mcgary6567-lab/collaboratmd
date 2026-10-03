import { expect, test } from "@playwright/test";

test("the sign-in page shows no demo passwords, and the demo opens in one click", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByLabel("Password")).toHaveValue("");
  await expect(page.getByText(/admin123|biller123|front123/)).toHaveCount(0);

  await page.getByRole("link", { name: "Try the demo practice" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole("button", { name: "Try as biller" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Jordan/ })).toBeVisible();
});

test("the home page shows no demo sign-in details", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/admin123|biller123|front123|admin@collaboratmd\.local/)).toHaveCount(0);
});
