import { expect, type Page, test } from "@playwright/test";

// Playwright normally hides Chromium's scrollbars in headless mode, which
// removes the exact 15px boundary observed on the deployed mobile page.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function reserveScrollbarGutter(page: Page) {
  // Classic scrollbars consume layout width. Reserving their gutter makes this
  // boundary deterministic even on machines where page height varies.
  await page.evaluate(() => {
    document.documentElement.style.scrollbarGutter = "stable";
    document.body.style.minHeight = "calc(100vh + 1px)";
  });
  await page.evaluate(() => document.fonts.ready);
}

async function expectAvailableWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    available: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(dimensions.available, JSON.stringify(dimensions)).toBeLessThan(dimensions.viewport);
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.available);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.available);
  expect(dimensions.bodyScroll).toBeLessThanOrEqual(dimensions.available);
}

test("320px pages fit clientWidth including a classic vertical scrollbar gutter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.route("**/api/cases", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: { needsConsent: false } }),
  );
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: {} }));
  for (const path of ["/", "/login", "/cases", "/cases/new", "/settings"]) {
    await page.goto(path);
    await reserveScrollbarGutter(page);
    await expect(page.locator(".brand img").first()).toBeVisible();
    await expectAvailableWidth(page);
    const label = path === "/" ? "home" : path.slice(1).replaceAll("/", "-");
    await page.screenshot({
      path: `.wrangler/mobile-scrollbar-320-${label}.png`,
    });
  }
});

test("mobile menu keyboard flow and 200% fixture fit the available scrollbar width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/__design-system");
  await expect(page.getByRole("heading", { name: "공유 UI 구성 요소" })).toBeVisible();
  await page.locator("astro-island[ssr]").waitFor({ state: "detached" });
  await reserveScrollbarGutter(page);
  await expectAvailableWidth(page);
  const opener = page.getByRole("button", { name: "메뉴 열기" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.screenshot({ path: ".wrangler/mobile-scrollbar-menu-320.png" });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expectAvailableWidth(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectAvailableWidth(page);
  await page.screenshot({ path: ".wrangler/mobile-scrollbar-fixture-200.png", fullPage: true });
});
