import { expect, test } from "@playwright/test";

/**
 * Authenticated app-shell parity. Requires E2E_EMAIL/E2E_PASSWORD against a
 * seeded environment (both stacks get the same fixtures).
 */

const EMAIL = process.env.E2E_EMAIL ?? "e2e-parity@brightbean.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "parity-suite-password";

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/accounts/login");
    await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/organizations|workspaces/, { timeout: 15_000 });
}

const IS_NEW = (process.env.E2E_STACK ?? "new") === "new";

test.describe.serial("app shell", () => {
  test.skip(!IS_NEW, "app-shell specs target the new stack URLs; legacy covered by auth.spec reference");
  let workspaceUrl: string | null = null;

  test("login lands on an organization workspace list", async ({ page }) => {
    await login(page);
    // Open the first available workspace if one exists.
    const firstWorkspace = page.locator('a[href*="/workspace/"]').first();
    if (await firstWorkspace.isVisible().catch(() => false)) {
      workspaceUrl = await firstWorkspace.getAttribute("href");
      await firstWorkspace.click();
      await expect(page).toHaveURL(/\/workspace\//);
    }
  });

  test("workspace nav shows legacy sections", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(workspaceUrl!);
    for (const section of ["Calendar", "Inbox", "Analytics", "Channels"]) {
      await expect(page.getByRole("link", { name: section })).toBeVisible();
    }
  });

  test("calendar renders the month grid", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(`${workspaceUrl}/calendar`);
    for (const day of ["Mon", "Wed", "Fri"]) {
      await expect(page.getByText(day, { exact: true }).first()).toBeVisible();
    }
  });

  test("composer form submits a draft post", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(`${workspaceUrl}/composer`);

    const hasAccount = await page
      .locator('input[type="checkbox"]')
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!hasAccount, "composer needs at least one connected channel");

    await page.getByLabel("Title").fill("Parity suite draft");
    await page
      .getByLabel("Caption")
      .fill("Created by the cross-stack parity Playwright suite.");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(
      page.getByText(/Post saved/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("inbox loads with status filters", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(`${workspaceIdPath(workspaceUrl!)}/inbox`);
    for (const status of ["unread", "open", "resolved", "archived"]) {
      await expect(page.getByRole("button", { name: status })).toBeVisible();
    }
  });

  test("analytics renders KPI cards or empty state", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(`${workspaceIdPath(workspaceUrl!)}/analytics`);
    await expect(page.getByText("Followers", { exact: true }).or(page.getByText(/No analytics|Select an account/))).toBeVisible();
  });

  test("media library loads and exposes upload control", async ({ page }) => {
    test.skip(!workspaceUrl, "no seeded workspace in this environment");
    await page.goto(`${workspaceIdPath(workspaceUrl!)}/media`);
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });
});

/** /workspace/<id>/… → /workspace/<id> */
function workspaceIdPath(url: string): string {
  return url.replace(/(\/workspace\/[^/]+).*$/, "$1");
}
