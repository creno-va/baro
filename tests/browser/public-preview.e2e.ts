import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { goToCaseTool, returnToCaseConversation } from "../helpers/case-navigation";
import { openReportEditor } from "../helpers/report-controls";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("baro-api-mock-v1:session"))
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({
          user: { id: "public-preview-customer", name: "합성 체험 고객", accountType: "customer" },
          needsConsent: false,
        }),
      );
  });
});

test("app opens directly without launch notice on desktop and 320px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/new");
  const modal = page.getByRole("dialog", { name: "BARO를 먼저 만나보세요" });
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText(/2026\.11\.(01|10)/)).toHaveCount(0);
  await expect(page.locator('a[href="/lawyers"], a[href="/lawyer"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/baro-public-preview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/baro-public-preview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("intake opens the restored workspace and report controls without lawyer contact navigation", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/new");
  await expect(page.locator('a[href="/lawyers"], a[href="/lawyer"]')).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill(
      "공개 체험 검증을 위한 합성 사건입니다. 지인에게 빌려준 돈과 반환 약속을 확인하고 싶습니다.",
    );
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 1; index <= 6; index++) {
    await expect(
      page.getByText(`${Math.ceil(index / 3)}차 질문 · ${((index - 1) % 3) + 1} / 3`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "모름", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/summary$/);
  await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "이 내용으로 계속할까요?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "확인하고 계속", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  // Empty input still prevents submission; only the launch restriction is removed.
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "추가 사실 또는 질문" }).fill("합성 추가 사실입니다.");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  const casePath = new URL(page.url()).pathname;
  await goToCaseTool(page, "files");
  await expect(page).toHaveURL(`${casePath}/files`);
  await expect(page.getByRole("button", { name: /^(파일 선택|파일 추가)$/ })).toBeEnabled();
  await expect(page.getByLabel("업로드할 파일 선택", { exact: true })).toBeEnabled();
  await goToCaseTool(page, "timeline");
  await expect(page).toHaveURL(`${casePath}/timeline`);
  await expect(page.getByRole("button", { name: "일정 추가" })).toBeEnabled();
  await goToCaseTool(page, "actions");
  await expect(page).toHaveURL(`${casePath}/actions`);
  await expect(page.getByRole("heading", { name: "다음 행동", exact: true })).toBeVisible();
  await expect(page.locator('.workspace-action-list [role="checkbox"]').first()).toBeEnabled();
  await goToCaseTool(page, "reports");
  await expect(page).toHaveURL(`${casePath}/reports`);
  const preparation = page.getByRole("region", { name: "리포트 준비 상태", exact: true });
  await expect(preparation).toBeVisible();
  await preparation.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 버전 만들기" })).toBeEnabled();
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: / 수정$/ }).first()).toBeEnabled();
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toBeDisabled();
  await editor.fill(`${await editor.inputValue()}\n합성 검토 내용을 보완합니다.`);
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "검토 내용 저장" })).toHaveCount(0);
  await expect(page.getByLabel("내용·식별정보·선택한 사진을 확인했어요")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
  await returnToCaseConversation(page);
  await expect(page).toHaveURL(casePath);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
});
