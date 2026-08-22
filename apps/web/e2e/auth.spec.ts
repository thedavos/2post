import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

/**
 * Auth parity: signup → logout → login, plus unauthenticated redirect.
 * Credentials come from env so the same spec runs against either stack.
 */
const EMAIL = process.env.E2E_EMAIL ?? "e2e-parity@brightbean.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "parity-suite-password";

test.describe("auth", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/workspace/00000000-0000-0000-0000-000000000000/calendar");
    await expect(page).toHaveURL(/\/accounts\/login/);
  });

  test("signup creates an account and lands in the app", async ({ page }) => {
    const unique = `${Date.now()}`;
    const email = `e2e-${unique}@brightbean.test`;

    await page.goto("/accounts/signup");
    await waitForHydration(page);
    await page.getByLabel("Name").fill(`E2E ${unique}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    // Auto-provisioned org lands the user on its workspace list.
    await expect(page).toHaveURL(/organizations|workspaces/, { timeout: 15_000 });
  });

  test("login with wrong password shows an error", async ({ page }) => {
    await page.goto("/accounts/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  test("login → dashboard → logout round-trip", async ({ page }) => {
    await page.goto("/accounts/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/organizations|workspaces/, { timeout: 15_000 });

    // Session cookie grants protected pages.
    await page.goto("/");
    await expect(page).not.toHaveURL(/accounts\/login/);

    // Logout via API (cookie is httpOnly) then confirm the guard kicks back in.
    await page.evaluate(async () => {
      await fetch("/api/app/auth/logout", { method: "POST" });
    });
    await page.goto("/workspaces");
    await expect(page).toHaveURL(/\/accounts\/login/);
  });

  test("Google SSO button is present when configured", async ({ page }) => {
    await page.goto("/accounts/login");
    // Button always renders; whether the flow works depends on GOOGLE_AUTH_* envs.
    await expect(
      page.getByRole("link", { name: /continue with google/i }),
    ).toBeAttached();
  });
});
