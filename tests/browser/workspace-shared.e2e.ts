import { expect, type Page, test } from "@playwright/test";
import { openReportOptions } from "../helpers/report-controls";
import {
  closeWorkspaceMaterials,
  confirmWorkspaceUpload,
  openCaseTool,
  openWorkspaceMaterials,
  returnToWorkspace,
} from "../helpers/workspace-navigation";

// Read the same session-bound facade as ReportReview. Legacy provenance blocks
// stay in the saved snapshot even when the reading/editor UI omits duplicates.
async function preparedReport(page: Page, caseId: string) {
  return page.evaluate(async (id) => {
    const path = "/src/client/api/index.ts";
    const { api } = await import(path);
    return api.rework.peekReport(id);
  }, caseId);
}

function reportEvidence(page: Page) {
  return page.locator(".report-reading-section").filter({
    has: page.getByRole("heading", { name: "증거 자료", exact: true }),
  });
}
const mockCoverage = "API 예시 처리 완료 · 실제 OCR·ASR·영상 처리는 수행되지 않았어요.";

test.skip(
  process.env.BARO_WORKSPACE_SHARED_UI !== "true",
  "Run with PUBLIC_API_MODE=mock and BARO_WORKSPACE_SHARED_UI=true.",
);
test("common login and B intake flow through C workspace and D report with original files", async ({
  page,
}) => {
  const actualProcessing: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(v2|auth)\//.test(new URL(request.url()).pathname))
      actualProcessing.push(request.url());
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByLabel("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.").check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.goto("/cases/new");
  await page.getByRole("combobox", { name: "준비하는 방향" }).selectOption("unknown-prepare");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill(
      "공통 API 검증을 위한 합성 사건입니다. 지인에게 빌려준 돈과 반환 약속을 확인하고 싶습니다.",
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
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  await page
    .getByRole("dialog", { name: "이 내용으로 계속할까요?" })
    .getByRole("button", { name: "확인하고 계속", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  const base = new URL(page.url()).pathname;
  await closeWorkspaceMaterials(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "baro-api-mock-v1:faults",
      JSON.stringify({
        "workspace.sendMessage": ["chat_failed"],
        "files.uploadPart": ["UNAVAILABLE"],
      }),
    ),
  );
  await page
    .getByLabel("추가 사실 또는 질문")
    .fill("합성 메시지 원본과 약속 날짜를 확인하겠습니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "응답 다시 시도" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "응답 다시 시도" }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  const materials = await openWorkspaceMaterials(page);
  const source = {
    name: "shared-synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("공통 저장소의 합성 원본 자료입니다."),
  };
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await materials.getByRole("button", { name: "파일 선택", exact: true }).click();
  await (await chooser).setFiles(source);
  await materials
    .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
    .check();
  await materials.getByRole("button", { name: "선택한 자료 업로드", exact: true }).click();
  await materials.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByText("내용 확인 후 반영 가능", { exact: true })).toBeVisible();
  await page.reload();
  await openWorkspaceMaterials(page);
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByText("원본 추출 내용", { exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "자료 확인", exact: true })
      .locator("details p")
      .filter({ hasText: "공통 저장소의 합성 원본 자료입니다." }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "자료 확인", exact: true })
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  await closeWorkspaceMaterials(page);
  await openCaseTool(page, "다음 행동");
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("checkbox").first()).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await openCaseTool(page, "타임라인");
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("원본 메시지 날짜 확인");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByText("타임라인을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "원본 메시지 날짜 확인" })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-shared-desktop.png", fullPage: true });
  await openCaseTool(page, "리포트 보기");
  await expect(page).toHaveURL(`${base}/reports`);
  await expect(page.locator(".report-review")).toBeVisible();
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await openReportOptions(page);
  await expect(page.getByRole("region", { name: "리포트 준비 상태" })).toContainText(
    "공식 자료를 확인하지 못했어요",
  );
  const evidence = reportEvidence(page);
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText(`shared-synthetic.txt · ${mockCoverage}`);
  await expect(evidence).toContainText("공통 저장소의 합성 원본 자료입니다.");
  const savedReport = await preparedReport(page, decodeURIComponent(base.slice("/cases/".length)));
  expect(savedReport?.content).toContain("shared-synthetic.txt");
  expect(savedReport?.content).toContain("공통 저장소의 합성 원본 자료입니다.");
  await page.reload();
  await openReportOptions(page);
  await expect(evidence).toContainText(`shared-synthetic.txt · ${mockCoverage}`);
  expect(await preparedReport(page, decodeURIComponent(base.slice("/cases/".length)))).toEqual(
    savedReport,
  );
  await returnToWorkspace(page);
  await page.getByRole("link", { name: "변호사 찾기", exact: true }).click();
  await expect(page).toHaveURL(/\/lawyers$/);
  expect(actualProcessing).toEqual([]);
});

test("uploaded long mock material can be reviewed, edited and excluded after reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.evaluate(() => {
    const put = (name: string, value: unknown) =>
      localStorage.setItem(`baro-api-mock-v1:${name}`, JSON.stringify(value));
    put("session", {
      user: { id: "synthetic-material-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    });
    put("caseOwners", { "synthetic-material-case": "synthetic-material-owner" });
    put("cases", {
      "synthetic-material-case": {
        id: "synthetic-material-case",
        title: "Synthetic material",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-01T00:00:00Z",
        summary: "Synthetic reviewed facts",
        schemaVersion: "2",
      },
    });
    put("reworkContexts", {
      "synthetic-material-case": {
        casePurpose: "prepare_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      },
    });
    put("files", {});
  });
  await page.goto("/cases/synthetic-material-case/files");
  await page.locator('astro-island[component-export="Workspace"]:not([ssr])').waitFor();
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeEnabled();
  const text = `${"a".repeat(5000)}Synthetic second chunk`;
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "긴 합성 자료.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await confirmWorkspaceUpload(page);
  await expect(page.getByText("내용 확인 후 반영 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
  const review = page.getByRole("region", { name: "자료 내용 검토" });
  const editors = review.getByRole("textbox", { name: "확인·교정한 내용" });
  await expect(editors).toHaveCount(2);
  await expect(editors.nth(0)).toHaveValue("a".repeat(5000));
  await expect(editors.nth(1)).toHaveValue("Synthetic second chunk");
  await editors.nth(0).fill("Synthetic corrected first chunk");
  await review.getByRole("checkbox", { name: "사건 정리와 새 리포트에 포함" }).nth(1).uncheck();
  await review.getByRole("button", { name: "교정 내용 저장" }).click();
  await expect(
    review.getByRole("status").filter({ hasText: "교정 내용을 저장했어요." }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await expect(editors).toHaveCount(2);
  await expect(editors.nth(0)).toHaveValue("Synthetic corrected first chunk");
  await expect(
    review.getByRole("checkbox", { name: "사건 정리와 새 리포트에 포함" }).nth(1),
  ).not.toBeChecked();
  await review.getByText("원본 추출 내용", { exact: true }).nth(0).click();
  await expect(review.locator("fieldset").nth(0).locator("details p")).toHaveText("a".repeat(5000));
  await page.goto("/cases/synthetic-material-case/reports");
  await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await openReportOptions(page);
  await expect(page.getByRole("region", { name: "리포트 준비 상태" })).toContainText(
    "공식 자료를 확인하지 못했어요",
  );
  const evidence = reportEvidence(page);
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText(`긴 합성 자료.txt · ${mockCoverage}`);
  await expect(evidence).toContainText("Synthetic corrected first chunk");
  await expect(evidence).not.toContainText("Synthetic second chunk");
  const report = await preparedReport(page, "synthetic-material-case");
  expect(report?.content).toContain("긴 합성 자료.txt");
  expect(report?.content).toContain("Synthetic corrected first chunk");
  expect(report?.content).not.toContain("Synthetic second chunk");
  await page.reload();
  await openReportOptions(page);
  await expect(evidence).toContainText(`긴 합성 자료.txt · ${mockCoverage}`);
  await expect(evidence).toContainText("Synthetic corrected first chunk");
  await expect(evidence).not.toContainText("Synthetic second chunk");
  expect(await preparedReport(page, "synthetic-material-case")).toEqual(report);
});
