import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  countMaterialsRequests,
  materialsCasePath,
  materialsFixtureKey,
  seedMaterialsScenario,
  setMaterialsReportRead,
} from "../helpers/workspace-materials-scenario";
import {
  closeWorkspaceMaterials,
  openCaseTool,
  openWorkspaceMaterials,
} from "../helpers/workspace-navigation";

const panel = (page: Page) => page.locator("#case-materials-panel");
const input = (page: Page) => page.getByRole("textbox", { name: "추가 사실 또는 질문" });
async function openMaterials(page: Page) {
  await openWorkspaceMaterials(page);
}
async function openScenario(page: Page, options = {}) {
  await seedMaterialsScenario(page, options);
  await page.goto(materialsCasePath);
  await expect(input(page)).toBeEnabled();
}

test("the mounted materials panel preserves the composer and selection without new reads or actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page);
  await input(page).fill("패널을 닫고 화면 폭을 바꿔도 남아 있어야 하는 합성 초안");
  await input(page).evaluate((node) => node.setAttribute("data-ui753-mounted", "original"));
  await openMaterials(page);
  const choice = panel(page).getByRole("checkbox", { name: /대화에 사용할.*반환 약속/ });
  await choice.check();
  await countMaterialsRequests(page);
  for (const width of [1024, 768, 390, 320, 1440]) {
    await closeWorkspaceMaterials(page);
    await expect(panel(page)).not.toBeVisible();
    await page.setViewportSize({ width, height: 900 });
    await expect(input(page)).toHaveValue(/합성 초안$/);
    await expect(input(page)).toHaveAttribute("data-ui753-mounted", "original");
    await openMaterials(page);
    await expect(choice).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  expect(
    await page.evaluate(() => {
      const state = window as unknown as {
        materialsRequestCounts: { workspace: number; files: number; action: number };
      };
      const { workspace, files, action } = state.materialsRequestCounts;
      return { workspace, files, action };
    }),
  ).toEqual({ workspace: 0, files: 0, action: 0 });
});

test("report readiness follows authorized progress reads and never starts work when opening the panel", async ({
  page,
}) => {
  await openScenario(page, { files: 0 });
  await openMaterials(page);
  await countMaterialsRequests(page);
  for (const [status, label] of [
    ["pending", "리포트 준비 중"],
    ["ready", "리포트를 열 수 있어요"],
    ["stale", "갱신이 필요해요"],
    ["failed", "리포트 준비 실패"],
    ["not_started", "아직 리포트가 없어요"],
    ["unavailable", "준비 상태를 확인하지 못했어요"],
  ] as const) {
    await setMaterialsReportRead(page, status);
    await panel(page).getByRole("button", { name: "리포트 상태 다시 확인", exact: true }).click();
    await expect(panel(page).getByRole("status")).toContainText(label);
    await expect(panel(page).getByRole("link", { name: "리포트 열기", exact: true })).toBeEnabled();
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { action: number } }).materialsRequestCounts
          .action,
    ),
  ).toBe(0);
});

test("review selection is separate from conversation selection and dirty correction survives resize and Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page);
  await openMaterials(page);
  await panel(page)
    .getByRole("checkbox", { name: /대화에 사용할.*반환 약속/ })
    .check();
  const second = panel(page).locator(".workspace-file-list > li").nth(1);
  await second.getByRole("button", { name: "자료 확인", exact: true }).click();
  const review = page.getByRole("dialog", { name: "자료 확인", exact: true });
  const correction = review.getByRole("textbox", { name: "확인·교정한 내용" });
  await correction.fill("합성 교정: 반환 날짜는 아직 확인되지 않았습니다.");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(correction).toHaveValue("합성 교정: 반환 날짜는 아직 확인되지 않았습니다.");
  page.once("dialog", (dialog) => dialog.dismiss());
  await correction.press("Escape");
  await expect(review).toBeVisible();
  await expect(correction).toHaveValue("합성 교정: 반환 날짜는 아직 확인되지 않았습니다.");
  await expect(review.getByRole("button", { name: "자료 내용 반영하기" })).toBeDisabled();
  await review.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(review.getByText("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.")).toBeVisible();
  await review.getByRole("button", { name: "닫기", exact: true }).first().click();
  await expect(
    panel(page).getByRole("checkbox", { name: /대화에 사용할.*반환 약속/ }),
  ).toBeChecked();
  await expect(
    panel(page).getByRole("checkbox", { name: /대화에 사용할.*긴파일명/ }),
  ).not.toBeChecked();
});

test("local attachments and consent stay local across panel changes before one explicit send", async ({
  page,
}) => {
  await openScenario(page, { files: 0 });
  await input(page).fill("첨부와 함께 보내는 합성 입력");
  await page.getByLabel("사진 또는 파일 첨부", { exact: true }).setInputFiles({
    name: "패널 전환 중 보존할 합성 자료.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("합성 원본. 실제 사건 정보가 없습니다."),
  });
  await openMaterials(page);
  await closeWorkspaceMaterials(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(input(page)).toHaveValue("첨부와 함께 보내는 합성 입력");
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    "패널 전환 중 보존할 합성 자료.txt",
  );
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}")["synthetic-case"].length,
      materialsFixtureKey,
    ),
  ).toBe(0);
  await page.getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다." }).check();
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const upload = api.files.upload;
    const state = window as unknown as {
      materialsUploadCalls: number;
      materialsUploadCommitted: boolean;
      releaseMaterialsUpload?: () => void;
    };
    state.materialsUploadCalls = 0;
    state.materialsUploadCommitted = false;
    api.files = new Proxy(api.files, {
      get(target, property) {
        if (property !== "upload") return Reflect.get(target, property);
        return async (...args: Parameters<typeof upload>) => {
          state.materialsUploadCalls++;
          const result = await upload(...args);
          state.materialsUploadCommitted = true;
          await new Promise<void>((resolve) => {
            state.releaseMaterialsUpload = resolve;
          });
          return result;
        };
      },
    });
  });
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { materialsUploadCommitted?: boolean }).materialsUploadCommitted,
      ),
    )
    .toBe(true);
  await openMaterials(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await closeWorkspaceMaterials(page);
  await expect(input(page)).toHaveValue("첨부와 함께 보내는 합성 입력");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as Window & { materialsUploadCalls?: number }).materialsUploadCalls,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as Window & { releaseMaterialsUpload?: () => void }).releaseMaterialsUpload?.(),
  );
  await expect(page.locator(".workspace-message--user")).toHaveCount(1);
  await expect(page.locator(".workspace-message-attachments")).toContainText(
    "패널 전환 중 보존할 합성 자료.txt",
  );
  await page.reload();
  await expect(page.locator(".workspace-message--user")).toHaveCount(1);
});

test("reading earlier messages does not jump to the newest reply when panel width changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, { messages: 40 });
  const log = page.getByRole("log", { name: "사건 대화" });
  await log.evaluate((node) => {
    node.scrollTop = 200;
    node.dispatchEvent(new Event("scroll"));
  });
  const before = await log.evaluate((node) => node.scrollTop);
  await openMaterials(page);
  await closeWorkspaceMaterials(page);
  const after = await log.evaluate((node) => ({
    top: node.scrollTop,
    bottom: node.scrollHeight - node.clientHeight - node.scrollTop,
  }));
  expect(Math.abs(after.top - before)).toBeLessThan(20);
  expect(after.bottom).toBeGreaterThan(200);
});

test("Korean composition cannot send on Enter and duplicate submission admits one message", async ({
  page,
}) => {
  await openScenario(page, { files: 0 });
  await input(page).fill("한글 조합을 확인하는 합성 메시지");
  await countMaterialsRequests(page);
  await input(page).dispatchEvent("compositionstart");
  await input(page).dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  await input(page).dispatchEvent("compositionend", { data: "지" });
  expect(await page.locator(".workspace-message--user").count()).toBe(0);
  await input(page).evaluate((node) => {
    const field = node as HTMLTextAreaElement;
    field.form?.requestSubmit();
    field.form?.requestSubmit();
  });
  await expect(page.locator(".workspace-message--user")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { send: number } }).materialsRequestCounts
          .send,
    ),
  ).toBe(1);
});

test("a legacy file URL opens the same correction without loading private conversation context", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto(`${materialsCasePath}/files?file=synthetic-material-1`);
  const review = page.getByRole("dialog", { name: "자료 확인", exact: true });
  await expect(review.getByRole("textbox", { name: "확인·교정한 내용" })).toHaveValue(
    /합성 자료 1/,
  );
  await review.getByRole("button", { name: "닫기", exact: true }).first().click();
  await countMaterialsRequests(page);
  await page.reload();
  await expect(review).toBeVisible();
  await expect(page.locator(".workspace-tabs")).toHaveCount(0);
});

test("materials and composer remain readable and accessible at phone, tablet, desktop and zoom", async ({
  page,
}, testInfo) => {
  await openScenario(page, { messages: 2 });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openMaterials(page);
    const footer = panel(page).getByRole("link", { name: "리포트 열기", exact: true });
    await expect(footer).toHaveAttribute("href", `${materialsCasePath}/reports?mode=conversation`);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
    expect(
      (await new AxeBuilder({ page }).include(".case-workspace").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`materials-${width}.png`),
      animations: "disabled",
    });
    await closeWorkspaceMaterials(page);
    await expect(input(page)).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`conversation-${width}.png`),
      animations: "disabled",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(input(page)).toBeInViewport();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCaseTool(page, "타임라인");
  await page.getByRole("button", { name: "일정 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "타임라인 추가", exact: true });
  await dialog.getByLabel("어떤 일이 있었나요?").fill("확대한 화면에서 저장한 합성 일정");
  await dialog
    .getByLabel("상세 내용")
    .fill("모달이 열린 상태에서 배율을 변경해도 초안을 보존합니다.");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(dialog.getByLabel("상세 내용")).toHaveValue(
    "모달이 열린 상태에서 배율을 변경해도 초안을 보존합니다.",
  );
  const save = dialog.getByRole("button", { name: "타임라인 저장", exact: true });
  await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "확대한 화면에서 저장한 합성 일정", exact: true }),
  ).toBeVisible();
});
