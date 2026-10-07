import { expect, type Page, test } from "@playwright/test";
import type { QuestionView } from "../../src/client/api/types";

async function capture(page: Page, name: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `/tmp/baro-simple-intake-${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function openAnswerTools(page: Page) {
  const tools = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "답변 관리" }) });
  await expect(tools).toBeVisible();
  if (!(await tools.evaluate((element) => element.hasAttribute("open"))))
    await tools.locator("summary").click();
}

async function holdGeneration(page: Page, stage: "questions" | "summary", failed = false) {
  await page.evaluate(
    async ({ processingStage, failed }) => {
      const modulePath = "/src/client/api/core.ts";
      const fixturePath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(modulePath);
      const { casesMockHandlers } = await import(fixturePath);
      const key = "baro-api-mock-v1:intake";
      const records = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
        string,
        { narrative: string; questions: QuestionView[] }
      >;
      const entry = Object.entries(records)[0];
      if (!entry) throw new Error("Synthetic intake fixture is missing");
      const [id, intake] = entry;
      const second = intake.questions[1];
      if (processingStage === "questions") {
        intake.questions = intake.questions.slice(0, 1);
        localStorage.setItem(key, JSON.stringify(records));
      }
      const state = { ready: false, polls: 0 };
      (window as unknown as { intakeGeneration: typeof state }).intakeGeneration = state;
      let pending = false;
      let delivered = false;
      registerMockHandlers({
        "cases.advance": (raw: unknown, context: { key: string }) => {
          if (delivered) return casesMockHandlers["cases.advance"](raw, context);
          pending = true;
          return {
            ...casesMockHandlers["cases.getQuestions"](raw),
            processing: true,
            processingStage,
          };
        },
        "cases.getQuestions": (raw: unknown) => {
          const current = casesMockHandlers["cases.getQuestions"](raw);
          if (!pending)
            return {
              ...current,
              failed: failed && !delivered,
              retryable: failed && !delivered,
              processingStage,
            };
          state.polls++;
          if (!state.ready) return { ...current, processing: true, processingStage };
          pending = false;
          delivered = true;
          if (processingStage === "questions") {
            const latest = JSON.parse(localStorage.getItem(key) ?? "{}");
            latest[id].questions.push(second);
            localStorage.setItem(key, JSON.stringify(latest));
            return casesMockHandlers["cases.getQuestions"](raw);
          }
          return casesMockHandlers["cases.advance"](
            { id, expectedRevision: current.revision },
            { key: "synthetic-summary-completion" },
          );
        },
      });
    },
    { processingStage: stage, failed },
  );
}

async function finishGeneration(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { intakeGeneration: { ready: boolean } }).intakeGeneration.ready = true;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("baro-api-mock-v1:session"))
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({
          user: { id: "example-customer", name: "예시 고객", accountType: "customer" },
          needsConsent: false,
        }),
      );
  });
});
test("two-question mobile flow saves/reloads/resumes/back edits/skips and reaches workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  const localOrigin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:4341").origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== localOrigin) external.push(request.url());
  });
  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "아직 정리한 사건이 없어요" })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCSS("view-transition-name", "none");
  await page.getByRole("link", { name: "첫 사건 만들기" }).click();
  await expect(page.locator(".conversation-home")).toHaveCSS("view-transition-name", "intake-page");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await narrative.fill(
    "합성 사건입니다. 지난달 지인에게 빌려준 돈을 약속한 날짜가 지나도 돌려받지 못했습니다.",
  );
  await capture(page, "input-mobile");
  await page.getByRole("button", { name: "저장하고 계속" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/intake/);
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCSS("view-transition-name", "none");
  await expect(page.locator(".intake-flow")).toHaveCSS("view-transition-name", "intake-page");
  await capture(page, "question-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, "question-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "나중에 이어하기" })).toBeHidden();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 9월");
  await openAnswerTools(page);
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "답변이 저장됐어요" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue("2026년 9월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await expect(page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" })).toBeVisible();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await openAnswerTools(page);
  const resumeLater = page.getByRole("button", { name: "나중에 이어하기" });
  await resumeLater.click();
  const exitDialog = page.getByRole("dialog", { name: "내 사건에서 다시 이어갈 수 있어요" });
  await expect(exitDialog).toBeVisible();
  await expect(exitDialog).toHaveJSProperty("open", true);
  await expect(exitDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(exitDialog.getByRole("button", { name: "계속 답하기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(exitDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(exitDialog).toBeHidden();
  await expect(resumeLater).toBeFocused();
  await resumeLater.press("Enter");
  await page.getByRole("link", { name: "목록으로 이동" }).click();
  await page.getByRole("link").filter({ hasText: "이어 답하기" }).click();
  await expect(
    page.getByRole("heading", {
      name: "얼마의 금액이 관련되어 있나요?",
    }),
  ).toBeVisible();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  const summary = page.getByRole("textbox", { name: "요약 편집" });
  await expect(summary).toHaveValue(/2026년 8월/);
  await expect(summary).toHaveValue(/건너뛰기/);
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "수정 취소", exact: true })).toHaveCount(0);
  await capture(page, "summary-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, "summary-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => {
      const records = JSON.parse(localStorage.getItem("baro-api-mock-v1:intake") ?? "{}");
      return (Object.values(records) as { questions: unknown[] }[]).map(
        (item) => item.questions.length,
      );
    }),
  ).toEqual([2]);
  const old = await summary.inputValue();
  await summary.fill(`${old}\n수정 취소 확인`);
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  await expect(summary).toHaveValue(old);
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toHaveCount(0);
  await summary.fill(`${old}\n합성 추가 사실입니다.`);
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "수정한 요약이 저장됐어요" }),
  ).toBeVisible();
  const confirmation = page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" });
  await expect(confirmation).toBeFocused();
  await page.reload();
  await expect(summary).toHaveValue(/합성 추가 사실입니다/);
  await confirmation.check();
  const reviewSummary = page.getByRole("button", { name: "요약 확인하고 계속" });
  await reviewSummary.click();
  const confirmDialog = page.getByRole("dialog", { name: "이제 사건 정리를 시작할까요?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmDialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmDialog).toBeHidden();
  await expect(reviewSummary).toBeFocused();
  await reviewSummary.press("Enter");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(reviewSummary).toBeFocused();
  await reviewSummary.press("Enter");
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  await page.goto("/cases");
  await expect(page.getByText("정리 진행 중", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("storage failure retains form input and retry completes exactly one creation", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 오류 테스트입니다. 저장 공간이 잠시 부족한 상황을 확인합니다.");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "baro-api-mock-v1:cases")
        throw new DOMException("synthetic", "QuotaExceededError");
      return original.call(this, key, value);
    };
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
  });
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page.getByText("예시 저장 공간이 부족해요", { exact: false })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveValue(
    /합성 오류 테스트/,
  );
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(/\/intake/);
  await page.goto("/cases");
  await expect(page.locator(".intake-case-card")).toHaveCount(1);
});
test("stale summary cannot overwrite newer content; keyboard and 200 percent layout work", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 충돌 테스트입니다. 서로 다른 화면에서 요약을 수정하는 상황입니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  const summary = page.getByRole("textbox", { name: "요약 편집" });
  await summary.fill("현재 화면에서 수정한 합성 요약");
  await page.evaluate(() => {
    const key = "baro-api-mock-v1:cases",
      items = JSON.parse(localStorage.getItem(key) ?? "{}");
    for (const item of Object.values(items) as { revision: number; summary: string }[]) {
      item.revision++;
      item.summary = "다른 화면에서 저장한 합성 요약";
    }
    localStorage.setItem(key, JSON.stringify(items));
  });
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("다른 화면에서 내용이 바뀌었어요");
  await expect(summary).toHaveValue("현재 화면에서 수정한 합성 요약");
  await page.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(summary).toHaveValue("다른 화면에서 저장한 합성 요약");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }),
  ).toBeChecked();
});

test("summary returns to editable questions and regenerates after a prior answer changes", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 수정 테스트입니다. 질문에 답한 뒤 요약에서 이전 답변을 고쳐 봅니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await page.getByRole("link", { name: "이전 답변 수정하기" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 7월로 수정");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/2026년 7월로 수정/);
});

test("a new form with identical input creates a new case after the previous request completed", async ({
  page,
}) => {
  const narrative =
    "합성 반복 입력 테스트입니다. 새 사건으로 같은 상황을 다시 입력하는 경우입니다.";
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    await page.goto("/cases/new");
    await page.getByRole("textbox", { name: "지금까지 있었던 일" }).fill(narrative);
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    await expect(page).toHaveURL(/\/intake/);
    ids.push(page.url().split("/")[4] ?? "");
  }
  expect(ids[0]).not.toBe(ids[1]);
  await page.goto("/cases");
  await expect(page.locator(".intake-case-card")).toHaveCount(2);
});

test("new follow-up generation retains the submitted answer and polls past the stale question URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 비동기 테스트입니다. 지인에게 빌려준 돈을 아직 돌려받지 못했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  const first = page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" });
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await expect(first).toBeVisible();
  await holdGeneration(page, "questions");
  await answer.fill("2026년 8월에 시작했어요.");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "다음 질문을 준비하고 있어요" }),
  ).toBeVisible();
  await expect(first).toBeVisible();
  await expect(answer).toHaveValue("2026년 8월에 시작했어요.");
  await expect(answer).toBeDisabled();
  await capture(page, "pending-mobile");
  await openAnswerTools(page);
  await expect(page.getByRole("button", { name: "이전 질문" })).toBeDisabled();
  await expect(page).toHaveURL(/question=0/);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { intakeGeneration: { polls: number } }).intakeGeneration.polls,
      ),
    )
    .toBeGreaterThan(0);
  await expect(first).toBeVisible();
  await expect(answer).toHaveValue("2026년 8월에 시작했어요.");
  await finishGeneration(page);
  await expect(page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page).toHaveURL(/question=1/);
  await expect(answer).toBeEnabled();
  await expect(answer).toHaveValue("");
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/2026년 8월/);
});

for (const editing of [false, true]) {
  test(`${editing ? "edited" : "new"} summary generation stays on the second answer and opens the summary when ready`, async ({
    page,
  }) => {
    await page.goto("/cases/new");
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일" })
      .fill("합성 요약 대기 테스트입니다. 지인에게 빌려준 돈과 약속 날짜를 정리해요.");
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    await page.getByRole("button", { name: "모름", exact: true }).click();
    if (editing) {
      await page.getByRole("button", { name: "모름", exact: true }).click();
      await expect(page).toHaveURL(/\/summary/);
      await page.getByRole("link", { name: "이전 답변 수정하기" }).click();
      await expect(page).toHaveURL(/edit=1/);
      await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
    }
    const second = page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" });
    const answer = page.getByRole("textbox", { name: "답변", exact: true });
    await expect(second).toBeVisible();
    await holdGeneration(page, "summary");
    await answer.fill("100만 원을 빌려줬어요.");
    await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "사건 요약을 정리하고 있어요" }),
    ).toBeVisible();
    await expect(second).toBeVisible();
    await expect(answer).toHaveValue("100만 원을 빌려줬어요.");
    await expect(answer).toBeDisabled();
    await capture(page, "summary-pending-desktop");
    await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { intakeGeneration: { polls: number } }).intakeGeneration.polls,
        ),
      )
      .toBeGreaterThan(0);
    await expect(second).toBeVisible();
    await expect(page).toHaveURL(/question=1/);
    await expect(page).not.toHaveURL(/edit=1/);
    await finishGeneration(page);
    await expect(page).toHaveURL(/\/summary/, { timeout: 10000 });
    await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/100만 원/);
  });
}

test("returning to the tab preserves a draft on a previous question", async ({ page }) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 포커스 복귀 테스트입니다. 지난달에 빌려준 돈과 약속 날짜를 확인합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await answer.fill("아직 저장하지 않은 2026년 9월 답변");
  await page.evaluate(async () => {
    const corePath = "/src/client/api/core.ts";
    const fixturePath = "/src/client/api/mock/cases.ts";
    const { registerMockHandlers } = await import(corePath);
    const { casesMockHandlers } = await import(fixturePath);
    const state = { calls: 0 };
    (window as unknown as { intakeRefresh: typeof state }).intakeRefresh = state;
    registerMockHandlers({
      "cases.getQuestions": (raw: unknown) => {
        state.calls++;
        return casesMockHandlers["cases.getQuestions"](raw);
      },
    });
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { intakeRefresh: { calls: number } }).intakeRefresh.calls,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await expect(answer).toHaveValue("아직 저장하지 않은 2026년 9월 답변");
  await expect(page).toHaveURL(/question=0/);
});

test("retrying a failed summary saves the edited answer before generation", async ({ page }) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 재시도 테스트입니다. 지인에게 빌려준 돈을 정리하다가 요약 준비에 실패했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("처음에는 100만 원이라고 적었어요.");
  await openAnswerTools(page);
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "답변이 저장됐어요" })).toBeVisible();
  await holdGeneration(page, "summary", true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toBeVisible();
  await answer.fill("확인해 보니 200만 원이에요.");
  await page.getByRole("button", { name: "답변 저장하고 다시 준비하기", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "사건 요약을 정리하고 있어요" }),
  ).toBeVisible();
  await expect(answer).toHaveValue("확인해 보니 200만 원이에요.");
  await finishGeneration(page);
  await expect(page).toHaveURL(/\/summary/, { timeout: 10000 });
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/200만 원/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).not.toHaveValue(/100만 원/);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`question transition waits for the saved response with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/cases/new");
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일" })
      .fill("합성 전환 테스트입니다. 지인에게 빌려준 돈과 약속 날짜를 차분히 정리하고 싶어요.");
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    const first = page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" });
    const second = page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" });
    const answer = page.getByRole("textbox", { name: "답변", exact: true });
    await expect(first).toBeVisible();
    const scene = page.locator(".intake-scene");
    const content = page.locator(".intake-scene-content");
    if (reducedMotion === "reduce") {
      await expect(content).toHaveCSS("animation-name", "none");
    } else {
      expect(
        await content.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).animationDuration),
        ),
      ).toBeGreaterThan(0);
    }
    await page.evaluate(async () => {
      const corePath = "/src/client/api/core.ts";
      const fixturePath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(corePath);
      const { casesMockHandlers } = await import(fixturePath);
      const state = { started: false, release: () => {} };
      (window as unknown as { intakeSave: typeof state }).intakeSave = state;
      registerMockHandlers({
        "cases.saveAnswers": async (raw: unknown, context: { key: string }) => {
          state.started = true;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
          return casesMockHandlers["cases.saveAnswers"](raw, context);
        },
      });
    });
    await answer.fill("2026년 9월부터예요.");
    await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { intakeSave: { started: boolean } }).intakeSave.started,
        ),
      )
      .toBe(true);
    await expect(first).toBeVisible();
    await expect(second).toHaveCount(0);
    await expect(answer).toHaveValue("2026년 9월부터예요.");
    await expect(answer).toBeDisabled();
    await expect(page).toHaveURL(/question=0/);
    await expect(scene).not.toHaveAttribute("data-transition", "leaving");
    await page.evaluate(() => {
      (window as unknown as { intakeSave: { release: () => void } }).intakeSave.release();
    });
    await expect(second).toBeVisible();
    await expect(second).toBeFocused();
    await expect(page).toHaveURL(/question=1/);
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue("");
    if (reducedMotion === "reduce") await expect(content).toHaveCSS("animation-name", "none");
  });
}
async function lastQuestion(page: Page) {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 복구 테스트입니다. 답변 저장 후 다음 질문을 준비하다 멈춘 상황입니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("보존할 합성 답변");
}

test("generation transport retry keeps the saved answer and never saves it twice", async ({
  page,
}) => {
  await lastQuestion(page);
  await page.evaluate(async () => {
    const corePath = "/src/client/api/core.ts";
    const mockPath = "/src/client/api/mock/cases.ts";
    const { registerMockHandlers, ApiError } = await import(corePath);
    const { casesMockHandlers: handlers } = await import(mockPath);
    const counts = { saves: 0, advances: 0, reads: 0, revisions: [] as number[] };
    registerMockHandlers({
      "cases.saveAnswers": (input: unknown, context: { key: string }) => {
        counts.saves++;
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        return handlers["cases.saveAnswers"](input, context);
      },
      "cases.advance": (input: { expectedRevision: number }, context: { key: string }) => {
        counts.advances++;
        counts.revisions.push(input.expectedRevision);
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        if (counts.advances === 1) throw new ApiError("UNAVAILABLE", "합성 연결 실패", true);
        return handlers["cases.advance"](input, context);
      },
      "cases.getQuestions": (input: unknown) => {
        counts.reads++;
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        return handlers["cases.getQuestions"](input);
      },
    });
  });
  await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
  await expect(page.getByRole("alert")).toContainText("합성 연결 실패");
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
    "보존할 합성 답변",
  );
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/보존할 합성 답변/);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("synthetic-recovery-counts") ?? "{}"),
    ),
  ).toEqual({ saves: 1, advances: 2, reads: 0, revisions: [3, 3] });
});

for (const recovery of [
  { retryable: true, canPrepareSummary: false },
  { retryable: false, canPrepareSummary: false },
  { retryable: false, canPrepareSummary: true },
]) {
  const { retryable, canPrepareSummary } = recovery;
  test(`output rejection preserves answers and offers only available recovery (retryable=${retryable}, summary=${canPrepareSummary})`, async ({
    page,
  }) => {
    await lastQuestion(page);
    await page.evaluate(async ({ retryable, canPrepareSummary }) => {
      const corePath = "/src/client/api/core.ts";
      const mockPath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(corePath);
      const { casesMockHandlers: handlers } = await import(mockPath);
      let advances = 0;
      registerMockHandlers({
        "cases.advance": (input: { id: string }, context: { key: string }) => {
          if (++advances === 1) {
            // Admission and terminal failure each advance the real workspace.
            // A user retry therefore starts from the failed job's new revision.
            const key = "baro-api-mock-v1:cases";
            const items = JSON.parse(localStorage.getItem(key) ?? "{}");
            items[input.id].revision += 2;
            localStorage.setItem(key, JSON.stringify(items));
            return {
              ...handlers["cases.getQuestions"](input),
              failed: true,
              retryable,
              canPrepareSummary,
              failure: "POLICY_REJECTED",
            };
          }
          return handlers["cases.advance"](input, context);
        },
      });
    }, recovery);
    await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "AI가 다음 질문이나 요약을 준비하지 못했어요",
    );
    await expect(page.getByRole("alert")).toContainText("저장한 답변은 그대로 남아 있어요");
    await expect(page.getByRole("alert")).not.toContainText("POLICY_REJECTED");
    await expect(page.getByRole("link", { name: "나중에 이어하기" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
      "보존할 합성 답변",
    );
    if (canPrepareSummary) {
      await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "저장한 답변으로 요약 보기" }).click();
    } else if (retryable) {
      await page.getByRole("button", { name: "다시 준비하기" }).click();
    } else {
      await expect(page.getByRole("button", { name: "다시 준비하기" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "저장하고 요약 보기" })).toBeDisabled();
      await page.getByRole("button", { name: "저장한 답변 확인·수정" }).click();
      await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
        "보존할 합성 답변",
      );
      await page.getByRole("textbox", { name: "답변", exact: true }).fill("수정한 합성 답변");
      await page.getByRole("button", { name: "답변 저장하고 다시 준비하기" }).click();
    }
    await expect(page).toHaveURL(/\/summary/);
    await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(
      retryable || canPrepareSummary ? /보존할 합성 답변/ : /수정한 합성 답변/,
    );
  });
}
