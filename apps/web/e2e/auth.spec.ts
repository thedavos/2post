import { expect, type Page, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

/**
 * Auth parity across stacks. E2E_STACK=legacy|new gates stack-specific bits;
 * selectors are data-testid-first (legacy templates carry them too).
 */
const EMAIL = process.env.E2E_EMAIL ?? "e2e-parity@brightbean.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "parity-suite-password";
const IS_NEW = (process.env.E2E_STACK ?? "new") === "new";

async function doLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/accounts/login");
  await waitForHydration(page);
  await page.getByTestId("login-login").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test.describe("auth", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    if (!IS_NEW) {
      // Legacy serves its shell for unknown workspaces — strict redirect is
      // new-stack behavior only.
      test.info().annotations.push({
        type: "note",
        description: "legacy renders shell for unknown workspace — skipped",
      });
      return;
    }
    await page.goto("/workspace/00000000-0000-0000-0000-000000000000/calendar");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/accounts\/login/, { timeout: 15_000 });
  });

  test("signup creates an account and lands in the app", async ({ page }) => {
    const unique = `${Date.now()}`;
    const email = `e2e-${unique}@brightbean.test`;

    await page.goto("/accounts/signup");
    await waitForHydration(page);

    if (IS_NEW) {
      await page.getByTestId("signup-name").fill(`E2E ${unique}`);
      await page.getByTestId("signup-email").fill(email);
      await page.getByTestId("signup-password").fill(PASSWORD);
      await page.getByRole("checkbox").check();
    } else {
      // Legacy signup fields: email + password1 only (ACCOUNT_SIGNUP_FIELDS).
      await page.getByTestId("signup-email").fill(email);
      await page.getByTestId("signup-password1").fill(PASSWORD);
    }

    await page.getByTestId("signup-submit").click();

    if (IS_NEW) {
      await expect(page).not.toHaveURL(/accounts\/(login|signup)/, { timeout: 20_000 });
      await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 10_000 });
    } else {
      // Legacy may land on / or require email verification before the app.
      await expect(page).toHaveURL(/dashboard|organizations|workspaces|confirm|verify|\/$/, {
        timeout: 20_000,
      });
    }
  });

  test("wrong password shows feedback (NEW STACK ONLY)", async ({ page }) => {
    // FINDING: legacy silently re-renders the login form with NO feedback on
    // bad credentials (allauth errors never surface in the template).
    // Pre-existing UX bug tracked for independent fix on both stacks.
    test.skip(!IS_NEW, "legacy shows no error on wrong password — see parity report");
    await doLogin(page, EMAIL, "definitely-wrong-password");

    const sharedError = page
      .getByTestId("auth-message")
      .or(page.getByTestId("field-error"));
    await expect(sharedError.first()).toBeVisible({ timeout: 15_000 });
  });

  test("login → app access round-trip", async ({ page }) => {
    await doLogin(page, EMAIL, PASSWORD);

    await expect(page).not.toHaveURL(/accounts\/login/, { timeout: 20_000 });

    if (!IS_NEW) return; // legacy lands on its own dashboard; logout via csrf flow

    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15_000 });

    await page.evaluate(async () => {
      await fetch("/api/app/auth/logout", { method: "POST" });
    });
    await page.goto("/workspaces");
    await page.waitForURL(/\/accounts\/login/, { timeout: 20_000 });
  });

  test("Google SSO button is present when configured", async ({ page }) => {
    await page.goto("/accounts/login");
    // New stack: link. Legacy: form button styled as social login.
    const googleControl = page
      .getByRole("link", { name: /continue with google/i })
      .or(page.locator('form[action*="google"] button'));
    await expect(googleControl.first()).toBeAttached();
  });
});
