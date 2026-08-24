
/**
 * Dev-mode hydration takes longer than networkidle (HMR + module graph).
 * Wait until the router has hydrated so clicks hit React handlers instead
 * of native form submits.
 */
export async function waitForHydration(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const tsr = (window as unknown as { $_TSR?: { hydrated?: boolean } }).$_TSR;
    return tsr ? tsr.hydrated === true : true;
  });
}
