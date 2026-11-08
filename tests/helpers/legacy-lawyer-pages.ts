import type { Page } from "@playwright/test";

/**
 * Explicitly opt old component/security regressions into a synthetic legacy page.
 * The product routes have independent 410/no-read assertions. Fixture routes only
 * exist with BARO_UI_TEST_FIXTURE and never turn a production 410 into a UI.
 */
export async function installLegacyLawyerPages(page: Page) {
  await page.route(/\/lawyers?(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const target = new URL(route.request().url());
    target.pathname = target.pathname.replace(/^\/lawyer(?=\/|$)/, "/__legacy-lawyer");
    target.pathname = target.pathname.replace(/^\/lawyers(?=\/|$)/, "/__legacy-lawyers");
    const response = await route.fetch({ url: target.href });
    await route.fulfill({ response });
  });
}
