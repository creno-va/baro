import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function captureCaseViewports(page: Page, name: string, selector = ".workspace") {
  const original = page.viewportSize();
  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `/tmp/baro-workspace-${name}-${viewport.name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  if (original) await page.setViewportSize(original);
}
