import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * A passkey added in a real browser and used to sign in, with the browser's
 * virtual authenticator standing in for a fingerprint reader.
 */
test("adds a passkey and signs in with it, with no password", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The virtual authenticator is a Chromium DevTools feature");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await signIn(page);
  await page.goto("/settings/security");
  await page.getByPlaceholder("e.g. Work laptop, iPhone").fill("Test browser");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText(/Passkey added/)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText("Test browser")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
});
