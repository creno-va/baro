import { expect, test } from "@playwright/test";
import sharp from "sharp";

// Opt-in exact-base visual comparison; no production network or user session.
test.skip(
  !process.env.BARO_SHELL_BASELINE_URL,
  "Set an isolated exact-base mock Astro server URL.",
);
for (const width of [390, 1440]) {
  for (const route of ["/", "/login"]) {
    test(`public ${route} keeps baseline pixels at ${width}px`, async ({ page, context }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${process.env.BARO_SHELL_BASELINE_URL}${route}`);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const name = route === "/" ? "landing" : "login";
      const before = await page.screenshot({
        path: `.wrangler/ui01/${name}-before-${width}.png`,
        animations: "disabled",
      });
      const afterPage = await context.newPage();
      await afterPage.emulateMedia({ reducedMotion: "reduce" });
      await afterPage.setViewportSize({ width, height: 900 });
      await afterPage.goto(route);
      await expect(afterPage.locator("astro-island[ssr]")).toHaveCount(0);
      await afterPage.evaluate(() => document.fonts.ready);
      const after = await afterPage.screenshot({
        path: `.wrangler/ui01/${name}-after-${width}.png`,
        animations: "disabled",
      });
      const [oldPixels, newPixels] = await Promise.all([
        sharp(before).raw().toBuffer(),
        sharp(after).raw().toBuffer(),
      ]);
      expect(newPixels.equals(oldPixels), `${name} must be pixel-identical to the exact base`).toBe(
        true,
      );
      await afterPage.close();
    });
  }
}
