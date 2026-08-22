import { defineConfig } from "@playwright/test";

/**
 * Parity suite — runs the same specs against BOTH stacks during phases 3–5:
 *   BASE_URL=https://staging-legacy… pnpm e2e   (Django, reference)
 *   BASE_URL=https://staging-new…    pnpm e2e   (TanStack+NestJS, candidate)
 *
 * Selectors are data-testid-first so both stacks can satisfy them
 * (the legacy templates get data-testid attributes added as needed).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
