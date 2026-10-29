import { expect, type Page, test } from "@playwright/test";
import { answerSchema } from "../../src/contracts/questions";
import {
  v2IntakeSchema,
  v2SummaryEditRequestSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "../../src/contracts/v2";
import { batch, intake, summary, workspace } from "../fixtures/contracts/v2";
import { settleIntakeSave } from "../helpers/intake-autosave";

const id = "synthetic-answer-case";
async function fixture(
  page: Page,
  value?: string,
  reject = false,
  options: {
    includeNext?: boolean;
    gateSave?: Promise<void>;
    peerAnswer?: string;
    postflightReject?: boolean;
  } = {},
) {
  const question = batch.questions[0];
  if (!question) throw new Error("MISSING_SYNTHETIC_QUESTION");
  const questions = options.includeNext ? batch.questions : [question];
  let saved = v2IntakeSchema.parse({
    ...intake,
    status: "collecting",
    summary: null,
    batches: [
      {
        ...batch,
        questions,
        answers:
          value === undefined
            ? []
            : [answerSchema.parse({ questionId: question.id, status: "answered", value })],
      },
    ],
  });
  let current = v2WorkspaceSchema.parse({
    ...workspace,
    id,
    status: "intake",
    confirmedSummaryRevision: null,
    legacySnapshotId: null,
  });
  const writes: { status: string; value?: string }[] = [];
  const requests: string[] = [];
  let fail = reject;
  let rejectPostflight = false;
  let postflightRejected = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    requests.push(`${req.method()} ${u.pathname}`);
    if (u.pathname === "/api/me/session" && rejectPostflight) {
      rejectPostflight = false;
      return route.fulfill({
        status: 503,
        json: { error: { code: "UNAVAILABLE", retryable: true } },
      });
    }
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: current });
    if (u.pathname.endsWith("/intake")) return route.fulfill({ json: saved });
    if (u.pathname.endsWith("/workspace-jobs/latest")) return route.fulfill({ json: null });
    if (u.pathname.endsWith("/intake/advance"))
      return route.fulfill({
        status: 503,
        json: { error: { code: "DISPATCH_FAILED", retryable: true } },
      });
    if (u.pathname.endsWith("/intake/answers") && req.method() === "PUT") {
      const answer = answerSchema.parse(req.postDataJSON().answers[0]);
      writes.push(answer);
      await options.gateSave;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: "DISPATCH_FAILED", retryable: true } },
        });
      saved = v2IntakeSchema.parse({
        ...saved,
        revision: saved.revision + 1,
        batches: [
          {
            ...batch,
            questions,
            answers: [
              ...(saved.batches[0]?.answers ?? []).filter(
                (item) => item.questionId !== answer.questionId,
              ),
              options.peerAnswer ? { ...answer, value: options.peerAnswer } : answer,
            ],
          },
        ],
      });
      current = v2WorkspaceSchema.parse({
        ...current,
        workspaceRevision: current.workspaceRevision + 1,
        intakeRevision: saved.revision,
      });
      if (options.postflightReject && !postflightRejected) {
        postflightRejected = true;
        rejectPostflight = true;
      }
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`/cases/${id}/intake?question=0`);
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toBeVisible();
  return {
    writes,
    requests,
    allowSave: () => {
      fail = false;
    },
  };
}

test("answers autosave without advancing, survive reload and keep only an inline back action", async ({
  page,
}) => {
  const f = await fixture(page);
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("입력 중인 합성 답변을 자동으로 보관합니다.");
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes).toHaveLength(1);
  expect(f.requests.some((request) => request.includes("/intake/advance"))).toBe(false);
  await page.reload();
  await expect(answer).toHaveValue("입력 중인 합성 답변을 자동으로 보관합니다.");
  await expect(page.getByText("답변 관리", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.locator(".intake-scene-action").evaluate((node) => {
      const back = node.querySelector(".intake-scene-back")?.getBoundingClientRect();
      const next = node.querySelector(".intake-scene-primary")?.getBoundingClientRect();
      if (!back || !next) throw new Error("Intake navigation missing");
      return {
        backRight: back.right,
        nextLeft: next.left,
        centerDifference: Math.abs(back.y + back.height / 2 - next.y - next.height / 2),
      };
    });
    expect(geometry.backRight).toBeLessThanOrEqual(geometry.nextLeft);
    expect(geometry.centerDifference).toBeLessThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    if (width !== 320)
      await page.screenshot({ path: `.wrangler/intake-autosave-${width}.png`, fullPage: true });
  }
});

test("autosave keeps typing enabled and a late acknowledgement cannot overwrite newer input", async ({
  page,
}) => {
  let release!: () => void;
  const gateSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(page, undefined, false, { gateSave });
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("먼저 보내는 합성 답변");
  await expect.poll(() => f.writes.length).toBe(1);
  await expect(answer).toBeEnabled();
  await answer.fill("응답을 기다리며 새로 쓴 합성 답변 ");
  release();
  await expect(answer).toHaveValue("응답을 기다리며 새로 쓴 합성 답변 ");
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes.map((write) => write.value)).toEqual([
    "먼저 보내는 합성 답변",
    "응답을 기다리며 새로 쓴 합성 답변",
  ]);
  expect(f.requests.some((request) => request.includes("/intake/advance"))).toBe(false);
  await page.reload();
  await expect(answer).toHaveValue("응답을 기다리며 새로 쓴 합성 답변");
});

test("failed autosave replays its original answer before saving newer edits", async ({ page }) => {
  const f = await fixture(page, undefined, true);
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("전송에 실패한 합성 답변");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".intake-scene-notice")).not.toContainText("저장됐어요");
  await answer.fill("실패 이후 수정한 합성 답변");
  f.allowSave();
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes.map((write) => write.value)).toEqual([
    "전송에 실패한 합성 답변",
    "전송에 실패한 합성 답변",
    "실패 이후 수정한 합성 답변",
  ]);
  await expect(answer).toHaveValue("실패 이후 수정한 합성 답변");
});

test("autosave detects a peer answer instead of claiming that the draft was saved", async ({
  page,
}) => {
  const f = await fixture(page, undefined, false, { peerAnswer: "다른 화면의 합성 답변" });
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("이 화면에서 작성한 합성 답변");
  await expect(page.getByRole("button", { name: "최신 내용 불러오기", exact: true })).toBeVisible();
  await expect(answer).toHaveValue("이 화면에서 작성한 합성 답변");
  await expect(page.locator(".intake-scene-notice")).not.toContainText("저장됐어요");
  expect(f.writes).toHaveLength(1);
  await page.getByRole("button", { name: "최신 내용 불러오기", exact: true }).click();
  await expect(answer).toHaveValue("다른 화면의 합성 답변");
});

test("going back flushes a valid answer before leaving the question", async ({ page }) => {
  const f = await fixture(page, "처음 질문의 합성 답변", false, { includeNext: true });
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await page.getByRole("radio", { name: "알고 있음", exact: true }).check();
  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
    "처음 질문의 합성 답변",
  );
  expect(f.writes.map((write) => write.value)).toEqual(["알고 있음"]);
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByRole("radio", { name: "알고 있음", exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("radio", { name: "알고 있음", exact: true })).toBeChecked();
});

test("IME composition finishes before autosave starts", async ({ page }) => {
  const f = await fixture(page);
  await page.clock.install();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.dispatchEvent("compositionstart");
  await answer.fill("조합 중인 합성 답변");
  await page.clock.runFor(1200);
  expect(f.writes).toHaveLength(0);
  await answer.dispatchEvent("compositionend");
  await page.clock.runFor(1000);
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes.map((write) => write.value)).toEqual(["조합 중인 합성 답변"]);
});

test("an owner change hides the draft and ignores the old autosave response", async ({ page }) => {
  let release!: () => void;
  const gateSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(page, undefined, false, { gateSave });
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("이전 계정의 합성 답변");
  await expect.poll(() => f.writes.length).toBe(1);
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user: null, needsConsent: false } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveCount(0);
  await expect(page.getByText("자동 저장됐어요.", { exact: true })).toHaveCount(0);
  expect(f.writes).toHaveLength(1);
});

test("postflight recovery keeps a reverted newer edit and does not advance the question", async ({
  page,
}) => {
  let release!: () => void;
  const gateSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(page, "처음 저장한 합성 답변", false, {
    gateSave,
    postflightReject: true,
    includeNext: true,
  });
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("응답 대기 중인 중간 합성 답변");
  await expect.poll(() => f.writes.length).toBe(1);
  await answer.fill("처음 저장한 합성 답변");
  release();
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.", {
    timeout: 12000,
  });
  await expect(answer).toHaveValue("처음 저장한 합성 답변");
  expect(f.writes.map((write) => write.value)).toEqual([
    "응답 대기 중인 중간 합성 답변",
    "처음 저장한 합성 답변",
  ]);
  await expect(page).toHaveURL(/question=0/);
  expect(f.requests.some((request) => request.includes("/intake/advance"))).toBe(false);
});

test("unchanged saved answers navigate inside the same round without API requests after reload", async ({
  page,
}) => {
  const f = await fixture(page, "저장된 합성 답변", false, { includeNext: true });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
    "저장된 합성 답변",
  );
  const before = f.requests.length;
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "사건의 날짜를 알고 있나요?" })).toBeVisible();
  expect(f.writes).toHaveLength(0);
  expect(f.requests).toHaveLength(before);
});

test("edited answers still save before same-round navigation and a final answer still advances", async ({
  page,
}) => {
  const f = await fixture(page, "저장된 합성 답변", false, { includeNext: true });
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("수정한 합성 답변");
  await page.getByRole("button", { name: "저장하고 다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "사건의 날짜를 알고 있나요?" })).toBeVisible();
  expect(f.writes).toEqual([{ questionId: "q1", status: "answered", value: "수정한 합성 답변" }]);
  await page.getByRole("radio", { name: "알고 있음", exact: true }).check();
  await page.getByRole("button", { name: "저장하고 2차 질문 보기", exact: true }).click();
  await expect
    .poll(() =>
      f.requests.some(
        (request) => request.endsWith("/intake/advance") && request.startsWith("POST "),
      ),
    )
    .toBe(true);
  expect(f.writes).toHaveLength(2);
});

for (const state of ["unknown", "skipped"] as const)
  test(`pending ${state} save displays saving before an actual rejected result`, async ({
    page,
  }) => {
    let release!: () => void;
    const gateSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(page, undefined, true, { gateSave });
    await page
      .getByRole("button", { name: state === "unknown" ? "모름" : "건너뛰기", exact: true })
      .click();
    await expect.poll(() => f.writes.length).toBe(1);
    const label = page.locator(".intake-scene-answer-state");
    await expect(label).toHaveText("답변을 저장하고 있어요.");
    await expect(label).not.toContainText("다시 시도");
    release();
    await expect(label).toHaveText("아직 저장되지 않았어요. 다시 시도해 주세요.");
    await expect(page.getByRole("alert")).toBeVisible();
  });

for (const state of ["unknown", "skipped"] as const)
  test(`a rejected ${state} save remains unsaved until acknowledged`, async ({ page }) => {
    const f = await fixture(page, undefined, true);
    await page
      .getByRole("button", { name: state === "unknown" ? "모름" : "건너뛰기", exact: true })
      .click();
    await expect.poll(() => f.writes.length).toBe(1);
    const label = page.locator(".intake-scene-answer-state");
    await expect(label).toContainText("아직 저장되지 않았어요");
    await expect(label).not.toContainText("저장했어요");
    await expect(page.getByRole("alert")).toBeVisible();
    f.allowSave();

    await settleIntakeSave(page);
    await expect.poll(() => f.writes.length).toBe(2);
    await expect(label).toHaveText(
      state === "unknown" ? "모름으로 저장했어요." : "건너뛰기로 저장했어요.",
    );
  });

test("a persisted 600-code-point emoji answer can be edited and saved", async ({ page }) => {
  const f = await fixture(page, "😀".repeat(600));
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await expect(answer).toHaveValue("😀".repeat(600));
  await answer.press("End");
  await answer.press("Backspace");
  await expect(answer).toHaveValue("😀".repeat(599));

  await settleIntakeSave(page);
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0]?.value).toBe("😀".repeat(599));
});

test("typing emoji counts code points and over-limit drafts cannot save", async ({ page }) => {
  const f = await fixture(page);
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.pressSequentially("😀".repeat(600));
  await expect(answer).toHaveValue("😀".repeat(600));
  await answer.fill("😀".repeat(1001));
  await expect(page.getByRole("alert")).toContainText("1,000자");

  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /저장하고/ }).first()).toBeDisabled();
  expect(f.writes).toHaveLength(0);
  await answer.fill("😀".repeat(1000));
  await settleIntakeSave(page);
  await expect.poll(() => f.writes.length).toBe(1);
  expect([...(f.writes[0]?.value ?? "")]).toHaveLength(1000);
});

test("custom choice answers autosave, restore and switch back to suggested options", async ({
  page,
}) => {
  const f = await fixture(page, "첫 질문의 합성 답변", false, { includeNext: true });
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await page.getByRole("radio", { name: "직접 입력", exact: true }).check();
  const answer = page.getByRole("textbox", { name: "직접 입력 답변", exact: true });
  await expect(answer).toBeFocused();
  await answer.fill("정확한 날짜는 모르지만 지난봄에 있었던 일입니다.");
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes.map((write) => write.value)).toEqual([
    "정확한 날짜는 모르지만 지난봄에 있었던 일입니다.",
  ]);
  expect(f.requests.some((request) => request.includes("/intake/advance"))).toBe(false);
  await page.reload();
  await expect(page.getByRole("radio", { name: "직접 입력", exact: true })).toBeChecked();
  await expect(answer).toHaveValue("정확한 날짜는 모르지만 지난봄에 있었던 일입니다.");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `.wrangler/intake-custom-${width}.png`, fullPage: true });
  }
  await page.getByRole("radio", { name: "알고 있음", exact: true }).check();
  await expect(answer).toHaveCount(0);
  await expect.poll(() => f.writes.at(-1)?.value).toBe("알고 있음");
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  await page.reload();
  await expect(page.getByRole("radio", { name: "알고 있음", exact: true })).toBeChecked();
  await expect(answer).toHaveCount(0);
});

test("custom choice late acknowledgement preserves the newer suggested answer", async ({
  page,
}) => {
  let release!: () => void;
  const gateSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(page, "첫 질문의 합성 답변", false, { includeNext: true, gateSave });
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await page.getByRole("radio", { name: "직접 입력", exact: true }).check();
  await page
    .getByRole("textbox", { name: "직접 입력 답변", exact: true })
    .fill("시기를 직접 설명한 합성 답변");
  await expect.poll(() => f.writes.length).toBe(1);
  await page.getByRole("radio", { name: "알고 있음", exact: true }).check();
  release();
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect(f.writes.map((write) => write.value)).toEqual([
    "시기를 직접 설명한 합성 답변",
    "알고 있음",
  ]);
  await expect(page.getByRole("textbox", { name: "직접 입력 답변", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("radio", { name: "알고 있음", exact: true })).toBeChecked();
});

test("custom choice text keeps the existing blank and Unicode length guards", async ({ page }) => {
  const f = await fixture(page, "첫 질문의 합성 답변", false, { includeNext: true });
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await page.clock.install();
  await page.getByRole("radio", { name: "직접 입력", exact: true }).check();
  const answer = page.getByRole("textbox", { name: "직접 입력 답변", exact: true });
  await answer.fill(" ");
  await page.clock.runFor(1200);
  expect(f.writes).toHaveLength(0);
  await answer.fill("😀".repeat(1001));
  await page.clock.runFor(1200);
  await expect(page.getByRole("alert")).toContainText("1,000자");
  expect(f.writes).toHaveLength(0);
  await answer.fill("😀".repeat(1000));
  await page.clock.runFor(1200);
  await expect(page.locator(".intake-scene-notice")).toHaveText("자동 저장됐어요.");
  expect([...(f.writes[0]?.value ?? "")]).toHaveLength(1000);
});

async function summaryFixture(page: Page) {
  const originalFact = summary.facts[0];
  if (!originalFact) throw new Error("MISSING_SYNTHETIC_FACT");
  let stored = v2SummarySchema.parse({
    ...summary,
    overview: "😀".repeat(3000),
    facts: [{ ...originalFact, text: "😀".repeat(1200) }],
  });
  let metadata = v2IntakeSchema.parse({ ...intake, summary: stored });
  let current = v2WorkspaceSchema.parse({
    ...workspace,
    id,
    status: "intake",
    confirmedSummaryRevision: null,
    legacySnapshotId: null,
  });
  const writes: { overview?: string | undefined; factEdits?: { text: string }[] | undefined }[] =
    [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (u.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (u.pathname.endsWith("/workspace")) return route.fulfill({ json: current });
    if (u.pathname.endsWith("/intake"))
      return route.fulfill({
        json: { ...metadata, summary: { id: "synthetic-summary", revision: stored.revision } },
      });
    if (u.pathname.endsWith("/summary")) {
      if (req.method() === "PUT") {
        const input = v2SummaryEditRequestSchema.parse(req.postDataJSON());
        writes.push(input);
        stored = v2SummarySchema.parse({
          ...stored,
          revision: stored.revision + 1,
          overview: input.overview ?? stored.overview,
          facts: stored.facts.map((fact) => {
            const edit = input.factEdits?.find((e) => e.factId === fact.id);
            return edit ? { ...fact, text: edit.text, userEdited: true } : fact;
          }),
        });
        metadata = v2IntakeSchema.parse({ ...metadata, summary: stored });
        current = v2WorkspaceSchema.parse({
          ...current,
          workspaceRevision: current.workspaceRevision + 1,
        });
      }
      return route.fulfill({ json: stored });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`/cases/${id}/summary`);
  await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toBeVisible();
  return writes;
}

test("persisted emoji summary remains editable without separate fact controls", async ({
  page,
}) => {
  const writes = await summaryFixture(page);
  const overview = page.getByRole("textbox", { name: "요약 편집", exact: true });
  await expect(overview).toHaveValue("😀".repeat(3000));
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  for (const field of [overview]) {
    // macOS End scrolls a multiline textarea without moving its caret.
    // Place only the caret explicitly; a real keypress must still edit the text.
    await field.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      input.setSelectionRange(input.value.length, input.value.length);
    });
    await field.press("Backspace");
  }
  await expect(overview).toHaveValue("😀".repeat(2999));
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.overview).toBe("😀".repeat(2999));
  expect(writes[0]?.factEdits).toBeUndefined();
  await expect(page.getByText("수정한 요약이 저장됐어요.", { exact: true })).toBeVisible();
});

test("summary limits block oversized code-point drafts without cutting input", async ({ page }) => {
  const writes = await summaryFixture(page);
  const overview = page.getByRole("textbox", { name: "요약 편집", exact: true });
  await overview.fill("😀".repeat(5001));
  await expect(overview).toHaveValue("😀".repeat(5001));
  await expect(page.getByRole("alert")).toContainText("5,000자");
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await overview.fill("😀".repeat(5000));
  await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeEnabled();
});
