import { expect, type Page } from "@playwright/test";

export async function closeWorkspaceMaterials(page: Page) {
  if (await page.locator("#case-materials-panel").isVisible())
    await page
      .getByRole("navigation", { name: "사건 작업", exact: true })
      .getByRole("link", { name: "대화", exact: true })
      .click();
}

export async function openWorkspaceMaterials(page: Page) {
  await page
    .getByRole("navigation", { name: "사건 작업", exact: true })
    .getByRole("link", { name: /^자료/ })
    .click();
  const panel = page.locator("#case-materials-panel");
  await expect(panel).toBeVisible();
  return panel;
}

export async function openCaseTool(page: Page, name: string | RegExp) {
  if ((typeof name === "string" && name.startsWith("자료")) || name === "리포트") {
    await page
      .getByRole("navigation", { name: "사건 작업", exact: true })
      .getByRole("link", { name: name === "리포트" ? "리포트" : /^자료/ })
      .click();
    return;
  }
  const summary = page.locator(".case-tools > summary");
  const menu = page.getByRole("navigation", { name: "사건 도구", exact: true });
  if (!(await menu.isVisible())) await summary.click();
  await menu.getByRole("link", { name, exact: typeof name === "string" }).click();
}

/** Selection is local. The explicit consent and upload are separate user actions. */
export async function confirmWorkspaceUpload(page: Page) {
  await page
    .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
    .check();
  await page.getByRole("button", { name: "선택한 자료 업로드", exact: true }).click();
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
    await page
      .getByRole("navigation", { name: "사건 작업", exact: true })
      .getByRole("link", { name: "리포트", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/reports\?mode=conversation$/);
  return page.locator(".report-review");
}
