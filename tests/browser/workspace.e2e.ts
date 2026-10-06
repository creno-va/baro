import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: "이어서 대화하기" })).toBeVisible();
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
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 날짜 확인");
  await page.getByLabel("상세 내용").fill("원본 메시지를 검토할 예정입니다.");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await page.reload();
  await expect(page.getByText("2026-10-01", { exact: true })).toBeVisible();
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
    state.faults = { "files.upload": ["file_failed"] };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const text = "브라우저 검증용 합성 자료입니다. 실제 사건 정보가 아닙니다.";
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByText("처리 실패", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "처리 다시 시도" }).click();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
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
  await page.reload();
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
});
test("mobile keyboard dialog, empty state, quota, stale input and safe image preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
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
  await page.getByRole("link", { name: /자료 0/ }).click();
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
});
