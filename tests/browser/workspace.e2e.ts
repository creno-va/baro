import { expect, test } from "@playwright/test";
import { captureCaseViewports } from "../helpers/case-ui-capture";

// This isolated C contract suite also runs before A's shared facade is available.
// Enable with: BARO_C_TEST_API=true bunx playwright test --config tests/helpers/workspace.playwright.config.ts
// It renders the same product routes/components and persists the API mock, including real upload bytes.
test.skip(
  process.env.BARO_C_TEST_API !== "true",
  "Run with the isolated workspace contract configuration.",
);
const key = "baro-c-contract-test-state";
const base = "/cases/synthetic-case";
test("chat failure/retry, reload, action checks and timeline editing on actual case routes", async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = { "workspace.sendMessage": ["chat_failed"] };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("확인이 필요한 합성 추가 사실입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "응답 다시 시도" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "응답 다시 시도" }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "다음 행동", exact: true }).click();
  const first = page.getByRole("checkbox").first();
  await first.check();
  await expect(first).toBeChecked();
  await expect(page.getByText("완료 표시를 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 날짜 확인");
  await page.getByLabel("상세 내용").fill("원본 메시지를 검토할 예정입니다.");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByLabel("날짜 정밀도").selectOption("day");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByText("타임라인을 저장했어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("2026-10-01", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-desktop.png", fullPage: true });
  await expect(page.getByRole("link", { name: "리포트 보기" }).first()).toHaveAttribute(
    "href",
    `${base}/reports`,
  );
  await expect(page.getByRole("link", { name: /변호사 탐색/ }).first()).toHaveAttribute(
    "href",
    "/lawyers",
  );
});
test("file processing failure, retry, extracted text, original bytes, cancellation and deletion persist", async ({
  page,
}) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = {
      "files.upload": ["file_failed"],
      "files.uploadPart": ["UNAVAILABLE", "UNAVAILABLE"],
    };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const text = "브라우저 검증용 합성 자료입니다. 실제 사건 정보가 아닙니다.";
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toBeVisible();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toHaveCount(1);
  await expect(page.getByText("처리 실패", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "처리 다시 시도" }).click();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByText("원본 추출 내용", { exact: true }).click();
  await expect(page.getByRole("dialog").getByText(text, { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "원본 확인 · 다운로드" }).click();
  expect((await download).suggestedFilename()).toBe("synthetic.txt");
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toBeVisible();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "자료 삭제 확인" }).click();
  await expect(page.getByText("자료를 삭제했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
});
test("mobile keyboard dialog, empty state, quota, stale input and safe image preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = { "workspace.sendMessage": ["QUOTA_EXCEEDED"] };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("합성 한도 요청");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("link", { name: "사용량 확인" })).toBeVisible();
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("합성 한도 요청");
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "일정 추가" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByRole("button", { name: "원본 확인 · 다운로드" }).click();
  await expect(page.getByAltText("synthetic.png 원본 미리보기")).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-mobile-preview.png", fullPage: true });
});

test("changing the shared mock owner hides the previous workspace and open editor", async ({
  page,
}) => {
  await page.goto(`${base}/timeline`);
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("공개하지 않을 합성 초안");
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.caseOwners = { "synthetic-case": "synthetic-owner" };
    state.session.user = { id: "other-owner", name: "다른 합성 사용자", accountType: "customer" };
    localStorage.setItem(storageKey, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByRole("alert")).toContainText("사건 또는 자료를 찾을 수 없어요.");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "대여금 반환 관련 자료 정리" })).not.toBeVisible();
  await expect(page.getByLabel("어떤 일이 있었나요?")).not.toBeVisible();
});

test("workspace panels keep their navigation, readable layouts and accessible controls on desktop and mobile", async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "사건 메뉴" }).getByRole("link")).toHaveCount(
    5,
  );
  await captureCaseViewports(page, "chat-welcome");
  await page
    .getByLabel("추가 사실 또는 질문")
    .fill("합성 자료의 날짜와 반환 약속을 차근차근 확인하고 싶어요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await captureCaseViewports(page, "chat");
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await (await chooser).setFiles({
    name: "반환 약속 메시지.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("반환 약속 날짜를 확인하는 합성 자료입니다."),
  });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await captureCaseViewports(page, "files");
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 메시지를 받음");
  await page.getByLabel("날짜 정밀도").selectOption("day");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByLabel("상세 내용").fill("메시지 원본의 날짜와 내용을 확인할 예정입니다.");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "사건의 흐름" })).toBeVisible();
  await captureCaseViewports(page, "timeline");
  await page.getByRole("link", { name: "다음 행동", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("progressbar", { name: "다음 행동 완료 현황" })).toHaveAttribute(
    "value",
    "1",
  );
  await captureCaseViewports(page, "actions");
});
