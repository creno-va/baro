import { expect, type Page, test } from "@playwright/test";
import { materialsCasePath, seedMaterialsScenario } from "../helpers/workspace-materials-scenario";

const navigation = (page: Page) => page.getByRole("navigation", { name: "사건 작업", exact: true });
async function task(page: Page, name: string) {
  await navigation(page).getByRole("link", { name, exact: true }).click();
}

async function seedReport(page: Page) {
  await seedMaterialsScenario(page, { messages: 4 });
  await page.goto(materialsCasePath);
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeEnabled();
  // Explicit fixture setup through the same mock adapter, before measuring navigation.
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    await api.reports.generate("synthetic-case");
  });
}

async function mutations(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      ["reports", "reportRequests", "reworkResolutions", "reworkReceipts"].map((key) => [
        key,
        localStorage.getItem(`baro-api-mock-v1:${key}`),
      ]),
    ),
  );
}

for (const width of [320, 390, 1440])
  test(`${width}px: direct report/hash routes retain edits, query, conversation text and owner-checked read versions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedReport(page);
    await page.goto(
      `${materialsCasePath}/reports?mode=conversation&version=kept&keep=alpha#document-drafts`,
    );
    await expect(
      navigation(page).getByRole("link", { name: "문서 초안", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "문서 초안", exact: true })).toBeVisible();
    const before = await mutations(page);
    await expect(
      page.getByRole("button", { name: "검토용 초안 준비", exact: true }),
    ).toBeDisabled();
    await task(page, "리포트");
    await expect(page.locator(".report-reading")).toBeVisible();
    await page.getByRole("button", { name: "수정하기", exact: true }).click();
    const editor = page.locator(".report-reading-section textarea").first();
    await editor.fill("SYNTHETIC-DIRECT-ROUTE-EDIT");
    await task(page, "대화");
    const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("대화로 돌아와도 보존할 미전송 설명");
    await task(page, "리포트");
    await expect(editor).toHaveValue("SYNTHETIC-DIRECT-ROUTE-EDIT");
    expect(new URL(page.url()).search).toBe("?mode=conversation&version=kept&keep=alpha");
    await task(page, "문서 초안");
    await expect(editor).toBeHidden();
    await task(page, "리포트");
    await expect(editor).toHaveValue("SYNTHETIC-DIRECT-ROUTE-EDIT");
    await page
      .locator(".report-reading-section")
      .first()
      .getByRole("button", { name: "이 내용 대화로 질문", exact: true })
      .click();
    await expect(input).toHaveValue("대화로 돌아와도 보존할 미전송 설명");
    await expect(
      page
        .getByRole("region", { name: "질문용 리포트 참조", exact: true })
        .getByText("SYNTHETIC-DIRECT-ROUTE-EDIT", { exact: true }),
    ).toBeVisible();
    expect(await mutations(page)).toEqual(before);
    await task(page, "리포트");
    await expect(editor).toHaveValue("SYNTHETIC-DIRECT-ROUTE-EDIT");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    if (width === 1440) {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
  });

test("direct report route does not expose another owner's report", async ({ page }) => {
  await seedReport(page);
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:caseOwners",
      JSON.stringify({ "synthetic-case": "another-owner" }),
    );
  });
  await page.goto(`${materialsCasePath}/reports?mode=conversation#document-drafts`);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.locator(".report-reading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "수정하기", exact: true })).toHaveCount(0);
});

test("direct report task preserves the draft review and requires explicit reviewed save", async ({
  page,
}) => {
  await seedReport(page);
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const current = await api.rework.getContext("synthetic-case");
    await api.rework.updateContext("synthetic-case", {
      expectedRevision: current.workspaceRevision,
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "civil", stage: "before_filing", description: null },
    });
    const state = await api.rework.getConversation("synthetic-case");
    await api.rework.executeAction(
      "synthetic-case",
      {
        action: "prepare_report",
        expectedRevision: state.workspaceRevision,
        requestId: crypto.randomUUID(),
      },
      { expectedOwner: "synthetic-owner" },
    );
  });
  await page.goto(`${materialsCasePath}/reports?mode=conversation#document-drafts`);
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "초안 검토·수정", exact: true });
  await expect(editor).toBeVisible();
  const review = page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.");
  await review.check();
  await task(page, "리포트");
  await task(page, "문서 초안");
  await expect(review).toBeChecked();
  await editor.fill("SYNTHETIC-UNSAVED-DRAFT-ROUTE");
  await expect(review).not.toBeChecked();
  await expect(page.getByRole("button", { name: "검토한 초안 저장", exact: true })).toBeDisabled();
  const before = await mutations(page);
  await task(page, "대화");
  await task(page, "문서 초안");
  await expect(editor).toHaveValue("SYNTHETIC-UNSAVED-DRAFT-ROUTE");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const lawyer = page.getByRole("button", { name: /^변호사와 해결/ });
  await lawyer.click();
  await page
    .getByRole("dialog", { name: "아직 지원하지 않는 기능이에요" })
    .getByRole("button", { name: "확인", exact: true })
    .click();
  await expect(lawyer).toBeFocused();
  expect(await mutations(page)).toEqual(before);
  await review.check();
  await page.getByRole("button", { name: "검토한 초안 저장", exact: true }).click();
  await expect(page.getByText("검토 완료 · 저장됨", { exact: true })).toBeVisible();
});
