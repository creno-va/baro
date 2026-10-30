import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("reviewed policies explain dataflow and confirmed operator details without anchor navigation at 320px/200%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  for (const path of ["/help", "/policies/terms", "/policies/privacy", "/policies/ai"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path.startsWith("/policies/")) {
      await expect(page.locator(".policy-heading")).toContainText("2026-10-31");
      await expect(page.getByRole("navigation", { name: "문서 목차" })).toHaveCount(0);
      await expect(page.locator('.policy-document a[href^="#"]')).toHaveCount(0);
      await expect(page.locator("article")).toContainText("hechec3534@naver.com");
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/policies/privacy");
  await expect(page.locator("article")).toContainText("Whisper");
  await expect(page.locator("article")).toContainText("Containers");
  await expect(page.locator("article")).toContainText("국외");
  await expect(page.locator("article")).toContainText("국가");
  await page.goto("/policies/ai-notice");
  await expect(page).toHaveURL(/\/policies\/ai$/);
  await page.screenshot({ path: ".wrangler/lawyer-policy-320.png", fullPage: true });
});
