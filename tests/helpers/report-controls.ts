import { expect, type Page } from "@playwright/test";

export async function openReportEditor(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".report-review")).toHaveAttribute("aria-busy", "false");
  if (
    await page
      .getByRole("textbox", { name: / 수정$/ })
      .first()
      .isVisible()
  )
    return;
  const toggle = page.locator(".report-edit-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Compatibility for older shell fixtures: report options now live in the document editor. */
export async function openReportOptions(page: Page) {
  await expect(page.locator(".report-reading")).toBeVisible();
}

export async function openReportGeneration(page: Page) {
  const action = page.getByRole("button", { name: "새 버전 만들기", exact: true });
  if (!(await action.isVisible()))
    await page.getByRole("button", { name: "편집 취소", exact: true }).click();
  await action.click();
}
