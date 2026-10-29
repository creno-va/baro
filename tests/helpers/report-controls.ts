import { expect, type Page } from "@playwright/test";

export async function openReportEditor(page: Page) {
  const toggle = page.locator(".report-edit-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

export async function openReportOptions(page: Page) {
  // Privacy settings are always visible; the old accordion no longer exists.
  await expect(page.getByRole("checkbox", { name: "식별정보 가리기", exact: true })).toBeVisible();
}
