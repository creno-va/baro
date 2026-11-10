import { expect, type Page } from "@playwright/test";

export async function closeWorkspaceMaterials(page: Page) {
  const close = page.getByRole("button", { name: "자료 패널 닫기", exact: true });
  if (await close.isVisible()) await close.click();
}

export async function openWorkspaceMaterials(page: Page) {
  const open = page.getByRole("button", { name: "자료 열기", exact: true });
  if (await open.isVisible()) await open.click();
  const panel = page.locator("#case-materials-panel");
  await expect(panel).toBeVisible();
  const materialsTab = page.getByRole("tab", { name: /^자료/ });
  if (await materialsTab.isVisible()) await materialsTab.click();
  return panel;
}

export async function openCaseTool(page: Page, name: string | RegExp) {
  const summary = page.locator(".case-tools > summary");
  const menu = page.getByRole("navigation", { name: "사건 도구", exact: true });
  if (!(await menu.isVisible())) await summary.click();
  await menu.getByRole("link", { name, exact: typeof name === "string" }).click();
}

export async function returnToWorkspace(page: Page) {
  await page.getByRole("link", { name: "대화로 돌아가기", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeVisible();
  await closeWorkspaceMaterials(page);
}

/** The link is a read transition and must never stand in for a prepare action. */
export async function readWorkspaceReport(page: Page) {
  if (!new URL(page.url()).pathname.endsWith("/reports")) {
    const entry = page
      .locator(".conversation-report-entry")
      .getByRole("link", { name: "리포트 열기", exact: true });
    if (await entry.isVisible()) await entry.click();
    else {
      const panel = await openWorkspaceMaterials(page);
      await panel.getByRole("link", { name: "리포트 열기", exact: true }).click();
    }
  }
  await expect(page).toHaveURL(/\/reports\?mode=conversation$/);
  return page.locator(".report-review");
}
