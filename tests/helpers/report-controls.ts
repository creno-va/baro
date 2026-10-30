import { expect, type Page } from "@playwright/test";

export async function openReportEditor(page: Page) {
  const toggle = page.locator(".report-edit-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Compatibility for older shell fixtures: report options now live in the document editor. */
export async function openReportOptions(page: Page) {
  await expect(page.locator(".report-reading")).toBeVisible();
}
