import { expect, test } from "@playwright/test";
import { openReportEditor, openReportOptions } from "../helpers/report-controls";

test.skip(
  process.env.BARO_WORKSPACE_SHARED_UI !== "true",
  "Run shared mock configuration on port 4342.",
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
  await page.getByLabel("만 14세 이상입니다.").check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.goto("/cases/new");
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
  await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  const base = new URL(page.url()).pathname;
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
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  const source = {
    name: "shared-synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("공통 저장소의 합성 원본 자료입니다."),
  };
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles(source);
  await page.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByText("원본 추출 내용", { exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .locator("details p")
      .filter({ hasText: "공통 저장소의 합성 원본 자료입니다." }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("link", { name: "다음 행동", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByText("완료 표시를 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("원본 메시지 날짜 확인");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByText("타임라인을 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "원본 메시지 날짜 확인" })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-shared-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "리포트 보기" }).first().click();
  await expect(page).toHaveURL(`${base}/reports`);
  await expect(page.getByRole("heading", { name: "전달할 리포트를 준비해요" })).toBeVisible();
  await openReportOptions(page);
  await expect(page.getByText("shared-synthetic.txt", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "사건으로 돌아가기" }).click();
  await page
    .getByRole("link", { name: /변호사 탐색/ })
    .first()
    .click();
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
    put("files", {});
  });
  await page.goto("/cases/synthetic-material-case/files");
  const text = `${"a".repeat(5000)}Synthetic second chunk`;
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "긴 합성 자료.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
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
  await openReportEditor(page);
  const report = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(report).toHaveValue(/Synthetic corrected first chunk/);
  await expect(report).not.toHaveValue(/Synthetic second chunk/);
});
