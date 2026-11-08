import { expect, type Page } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";

// Explicit local mock only. These fixtures prove UI behavior, never provider,
// legal, persistence-server, or ownership enforcement in production.
export const syntheticCaseId = "redesign-independent-synthetic";
export const unsentMessage = "검수용 미전송 설명입니다. 자료 원문을 확인한 뒤 다시 작성합니다.";

export async function seedRedesignCase(
  page: Page,
  accountType: "customer" | "lawyer" = "customer",
) {
  await page.addInitScript(
    ({ summary, caseId, accountType }) => {
      if (localStorage.getItem("redesign-independent-seeded")) return;
      localStorage.setItem("redesign-independent-seeded", "1");
      const owner = "redesign-synthetic-owner";
      const item = {
        id: caseId,
        title: "이미 일부 반환한 돈과 상대방의 남은 금액 요구를 함께 확인하는 합성 사건",
        schemaVersion: "2",
        stage: "active",
        revision: 1,
        updatedAt: new Date().toISOString(),
        summary:
          "실제 인물이 없는 검수 사건입니다. 일부 반환 사실과 남은 금액에 관해 서로 설명이 다릅니다.",
        summaryDetails: summary,
        subjectContext: "individual",
      };
      const values = {
        session: { user: { id: owner, name: "독립 합성 검수", accountType }, needsConsent: false },
        cases: { [caseId]: item },
        caseOwners: { [caseId]: owner },
        reworkContexts: {
          [caseId]: {
            casePurpose: "respond_to_claim",
            subjectContext: "individual",
            procedure: { kind: "civil", stage: "before_filing", description: null },
          },
        },
        workspace: { [caseId]: { messages: [], timeline: [], actions: [] } },
        files: { [caseId]: [] },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { summary, caseId: syntheticCaseId, accountType },
  );
}

export async function openRedesignConversation(page: Page) {
  await page.goto(`/cases/${syntheticCaseId}`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeEnabled();
}

export async function openMaterials(page: Page) {
  const open = page.getByRole("button", { name: "자료 열기", exact: true });
  if (await open.isVisible()) await open.click();
  const panel = page.locator("#case-materials-panel");
  if (!(await panel.isVisible())) await redesignTask(page, "자료").click();
  await expect(panel).toBeVisible();
  return panel;
}

export async function closeMaterials(page: Page) {
  const close = page.getByRole("button", { name: "자료 패널 닫기", exact: true });
  if (await close.isVisible()) await close.click();
  else if (await page.locator("#case-materials-panel").isVisible())
    await redesignTask(page, "대화").click();
}

export async function prepareRedesignReport(page: Page) {
  await page.goto(`/cases/${syntheticCaseId}/reports?mode=conversation`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(redesignResolution(page)).toBeVisible();
}

export function redesignResolution(page: Page) {
  return page.getByRole("region", {
    name: /^(리포트 이후 해결 방법|이해한 내용을 다음 준비로 이어가요)$/,
  });
}

export function redesignTask(page: Page, name: string) {
  const accessibleName = name === "자료" ? /^자료(?: \d+개)?$/ : name;
  return page
    .getByRole("link", { name: accessibleName, exact: true })
    .or(page.getByRole("button", { name: accessibleName, exact: true }));
}
