import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public help and drafts explain real dataflow, unresolved facts and distinct consent versions at 320px/200%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  for (const path of ["/help", "/policies/terms", "/policies/privacy", "/policies/ai"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path.startsWith("/policies/")) {
      await expect(page.getByRole("note", { name: "미승인 초안 안내" })).toContainText(
        "2026-10-06-v2-draft",
      );
      await expect(page.getByRole("note")).toContainText("2026-10-04");
      await expect(page.getByRole("navigation", { name: "문서 목차" })).toBeVisible();
      const first = page.getByRole("navigation", { name: "문서 목차" }).getByRole("link").first();
      await first.focus();
      await expect(first).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#/);
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
  await expect(page.locator("article")).toContainText("PDF 가림은 원본에 적용되지");
  await expect(page.locator("article")).toContainText("국가");
  await page.goto("/policies/ai-notice");
  await expect(page).toHaveURL(/\/policies\/ai$/);
  await page.screenshot({ path: ".wrangler/lawyer-policy-320.png", fullPage: true });
});
