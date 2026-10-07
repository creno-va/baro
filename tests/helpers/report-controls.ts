import { expect, type Page } from "@playwright/test";

export async function openReportOptions(page: Page) {
  const options = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "개인정보·자료 설정" }) });
  await expect(options).toBeVisible();
  if (!(await options.evaluate((element) => element.hasAttribute("open"))))
    await options.locator("summary").click();
}
