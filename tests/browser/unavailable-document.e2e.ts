import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { designTokens } from "../../packages/design-tokens/src";
import { renderUnavailableDocument } from "../../src/components/ui/unavailable-document";

for (const betaClosed of [false, true]) {
  for (const width of [320, 390, 1280]) {
    test(`${betaClosed ? "closed beta" : "session failure"} stays usable without scripts or assets at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 760 });
      const paths: string[] = [];
      await page.route("**/*", (route) => {
        const path = new URL(route.request().url()).pathname;
        paths.push(path);
        if (path === "/app")
          return route.fulfill({
            status: 503,
            headers: {
              "content-type": "text/html;charset=utf-8",
              "content-security-policy": "frame-ancestors 'none'",
              "retry-after": "30",
              "cache-control": "private, no-store, no-transform",
              "x-content-type-options": "nosniff",
            },
            body: renderUnavailableDocument(betaClosed),
          });
        if (path === "/")
          return route.fulfill({
            contentType: "text/html",
            body: '<html lang="ko"><title>합성 소개</title><body><h1>합성 서비스 소개</h1></body></html>',
          });
        return route.abort();
      });
      const response = await page.goto("http://unavailable.test/app");
      expect(response?.status()).toBe(503);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        betaClosed ? "공개 베타를 준비하고 있어요." : "로그인 상태를 확인할 수 없어요.",
      );
      await expect(
        page.locator("script,link[rel=stylesheet],meta[http-equiv=refresh]"),
      ).toHaveCount(0);
      const retry = page.getByRole("link", { name: "다시 시도하기", exact: true });
      const home = page.getByRole("link", { name: "서비스 소개로 돌아가기", exact: true });
      for (const link of [retry, home]) {
        const box = await link.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(designTokens.control.minimumSize);
        expect(box?.height).toBeGreaterThanOrEqual(designTokens.control.minimumSize);
      }
      await expect(retry).toHaveAttribute("href", "/app");
      await expect(home).toHaveAttribute("href", "/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.wrangler/unavailable-${betaClosed ? "beta" : "session"}-${width}.png`,
        fullPage: true,
      });
      await retry.focus();
      expect(await retry.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Enter");
      expect(paths).toEqual(["/app", "/app"]);
      await home.click();
      await expect(page.getByRole("heading", { name: "합성 서비스 소개" })).toBeVisible();
      expect(paths).toEqual(["/app", "/app", "/"]);
    });
  }
}

test("200% CSS zoom keeps the fallback title, recovery links and visible focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/html",
      headers: { "content-security-policy": "frame-ancestors 'none'" },
      body: renderUnavailableDocument(),
    }),
  );
  await page.goto("http://unavailable.test/app");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const retry = page.getByRole("link", { name: "다시 시도하기", exact: true });
  await retry.focus();
  await expect(retry).toBeInViewport();
  expect(await retry.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
  await page.screenshot({ path: ".wrangler/unavailable-200.png", fullPage: true });
});

test.describe("automated accessibility on the same script-free document", () => {
  // axe itself needs JavaScript. The six recovery-flow cases above keep it disabled.
  test.use({ javaScriptEnabled: true });
  for (const betaClosed of [false, true]) {
    for (const width of [320, 390, 1280]) {
      test(`${betaClosed ? "closed beta" : "session failure"} has no axe violations at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 760 });
        await page.route("**/*", (route) =>
          route.fulfill({
            status: 503,
            contentType: "text/html",
            headers: { "content-security-policy": "frame-ancestors 'none'" },
            body: renderUnavailableDocument(betaClosed),
          }),
        );
        await page.goto("http://unavailable.test/app");
        await expect(page.locator("script")).toHaveCount(0);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      });
    }
  }
});
