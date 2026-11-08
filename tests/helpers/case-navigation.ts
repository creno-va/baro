import { expect, type Page } from "@playwright/test";

const toolNames = {
  summary: "요약 보기 · 재확인",
  timeline: "타임라인",
  actions: "다음 행동",
  precedents: "유사 판례",
  files: /^자료(?:\s+\d+)?$/,
  reports: "리포트 보기",
} as const;

/** Open the visible disclosure with the same pointer action a customer uses. */
export async function openCaseTools(page: Page) {
  const menu = page.getByRole("navigation", { name: "사건 도구", exact: true });
  if (!(await menu.isVisible())) await page.locator(".case-tools > summary").click();
  await expect(menu).toBeVisible();
  return menu;
}

export async function goToCaseTool(page: Page, tool: keyof typeof toolNames) {
  const menu = await openCaseTools(page);
  await menu.getByRole("link", { name: toolNames[tool], exact: true }).click();
}

export async function returnToCaseConversation(page: Page) {
  await page.getByRole("link", { name: "대화로 돌아가기", exact: true }).click();
}
