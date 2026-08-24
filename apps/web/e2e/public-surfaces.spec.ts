import { expect, test } from "@playwright/test";

/**
 * Public surfaces: client portal + agent API contract spot-checks.
 */
const IS_NEW = (process.env.E2E_STACK ?? "new") === "new";

test.describe("client portal", () => {
  test("invalid magic link shows a friendly error", async ({ page }) => {
    test.skip(!IS_NEW, "legacy redirects invalid tokens (301) — UX parity tracked separately");
    await page.goto("/portal/definitely-invalid-token");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("portal decision rejects malformed payloads with 400", async ({ request }) => {
    test.skip(!IS_NEW, "endpoint is new-stack only");
    const response = await request.post("/api/app/portal/decision", {
      data: { token: "x" },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("agent API contract", () => {
  test("GET /api/v1/me without credentials → 401", async ({ request }) => {
    const response = await request.get("/api/v1/me");
    expect(response.status()).toBe(401);
  });

  test("rate-limit headers present on authenticated responses", async ({ request }) => {
    test.skip(!process.env.E2E_API_KEY, "E2E_API_KEY not provided");
    const response = await request.get("/api/v1/me", {
      headers: { authorization: `Bearer ${process.env.E2E_API_KEY}` },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-ratelimit-limit"]).toBeDefined();
    expect(response.headers()["x-ratelimit-remaining"]).toBeDefined();
  });

  test("health endpoint responds", async ({ request }) => {
    const response = await request.get("/health/");
    expect(response.ok()).toBeTruthy();
  });
});
