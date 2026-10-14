import { expect, type Page, test } from "@playwright/test";

// Synthetic local UI regression only. Adapter counters replace generation;
// these tests never create a real job or represent external AI success.
async function savedIntake(
  page: Page,
  options: { retryable?: boolean; processing?: boolean; needsConsent?: boolean } = {},
) {
  const caseId = "synthetic-saved-review";
  await page.addInitScript(
    ({ id, needsConsent }) => {
      const owner = "synthetic-saved-review-owner";
      const questions = Array.from({ length: 6 }, (_, index) => ({
        id: `saved-${index}`,
        text: `합성 저장 질문 ${index + 1}`,
        kind: "text",
        answerState: "answered",
        answer: `합성 저장 답변 ${index + 1}`,
      }));
      const values = {
        session: {
          user: { id: owner, name: "합성 검증 고객", accountType: "customer" },
          needsConsent,
        },
        cases: {
          [id]: {
            id,
            title: "저장한 답변 검토 회귀",
            subjectContext: "individual",
            stage: "intake",
            revision: 12,
            updatedAt: "2026-10-15T00:00:00.000Z",
            summary: "",
            schemaVersion: "2",
          },
        },
        caseOwners: { [id]: owner },
        intake: {
          [id]: {
            narrative: "실제 인물이나 계약이 없는 합성 검증 사건입니다.",
            questions,
            rounds: [
              { ordinal: 1, questionIds: questions.slice(0, 3).map((q) => q.id) },
              { ordinal: 2, questionIds: questions.slice(3).map((q) => q.id) },
            ],
          },
        },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
      localStorage.setItem("synthetic-review-advance-calls", "0");
      localStorage.setItem("synthetic-review-save-calls", "0");
    },
    { id: caseId, needsConsent: options.needsConsent ?? false },
  );
  const state = {
    failed: !options.processing,
    retryable: options.retryable ?? true,
    failure: options.processing ? null : "POLICY_REJECTED",
    processing: options.processing ?? false,
    processingStage: "summary",
  };
  await page.route("**/src/client/api/cases.ts*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `${body}
const syntheticReviewRead = casesApi.getQuestions;
const syntheticReviewSave = casesApi.saveAnswers;
const syntheticReviewState = ${JSON.stringify(state)};
casesApi.getQuestions = async (...args) => ({ ...await syntheticReviewRead(...args), ...syntheticReviewState });
casesApi.advance = async (id) => {
  localStorage.setItem("synthetic-review-advance-calls", String(Number(localStorage.getItem("synthetic-review-advance-calls")) + 1));
  return casesApi.getQuestions(id);
};
casesApi.saveAnswers = async (...args) => {
  localStorage.setItem("synthetic-review-save-calls", String(Number(localStorage.getItem("synthetic-review-save-calls")) + 1));
  return { ...await syntheticReviewSave(...args), ...syntheticReviewState };
};
`,
    });
  });
  await page.goto(`/cases/${caseId}/intake`);
  await expect(page.getByRole("heading", { name: "합성 저장 질문 6", exact: true })).toBeVisible();
  return page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"));
}

async function previousQuestion(page: Page, ordinal: number) {
  for (let current = 6; current > ordinal; --current) {
    await page.getByText("답변 관리", { exact: true }).click();
    await page.getByRole("button", { name: "이전 질문", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `합성 저장 질문 ${current - 1}`, exact: true }),
    ).toBeVisible();
  }
}

async function calls(page: Page) {
  return page.evaluate(() => ({
    advance: Number(localStorage.getItem("synthetic-review-advance-calls")),
    save: Number(localStorage.getItem("synthetic-review-save-calls")),
  }));
}

for (const retryable of [true, false]) {
  test(`failed summary reviews a previous saved answer without generation; retryable=${retryable}`, async ({
    page,
  }) => {
    const before = await savedIntake(page, { retryable });
    await page.getByRole("button", { name: "저장한 답변 확인·수정", exact: true }).click();
    await previousQuestion(page, 5);
    await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
      "합성 저장 답변 5",
    );
    await page.getByRole("button", { name: "다음 질문", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "합성 저장 질문 6", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
      "합성 저장 답변 6",
    );
    await expect(page.getByRole("alert")).toContainText(
      "AI가 다음 질문이나 요약을 준비하지 못했어요.",
    );
    expect(await calls(page)).toEqual({ advance: 0, save: 0 });
    expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
    if (!retryable) {
      await expect(
        page.getByRole("button", { name: "저장하고 요약 보기", exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toHaveCount(0);
    }
  });
}

test("failed summary review crosses an already generated round without saving or advancing", async ({
  page,
}) => {
  const before = await savedIntake(page);
  await previousQuestion(page, 3);
  await expect(page.getByText("1차 질문 · 3 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByText("2차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
    "합성 저장 답변 4",
  );
  expect(await calls(page)).toEqual({ advance: 0, save: 0 });
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
});

test("editing a saved previous answer still saves once before moving without generation", async ({
  page,
}) => {
  await savedIntake(page);
  await previousQuestion(page, 5);
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("수정한 합성 저장 답변 5");
  await page.getByRole("button", { name: "저장하고 다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 저장 질문 6", exact: true })).toBeVisible();
  expect(await calls(page)).toEqual({ advance: 0, save: 1 });
  expect(
    await page.evaluate(() => {
      const intake = JSON.parse(localStorage.getItem("baro-api-mock-v1:intake") ?? "{}");
      return intake["synthetic-saved-review"].questions[4].answer;
    }),
  ).toBe("수정한 합성 저장 답변 5");
});

for (const explicitRetry of [false, true]) {
  test(`summary generation requires the last-question action or an explicit retry; explicit=${explicitRetry}`, async ({
    page,
  }) => {
    await savedIntake(page);
    if (explicitRetry) await previousQuestion(page, 5);
    await page
      .getByRole("button", {
        name: explicitRetry ? "다시 준비하기" : "저장하고 요약 보기",
        exact: true,
      })
      .click();
    await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 0 });
  });
}

test("summary processing continues to lock saved-answer navigation and edits", async ({ page }) => {
  await savedIntake(page, { processing: true });
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toBeDisabled();
  await page.getByText("답변 관리", { exact: true }).click();
  await expect(page.getByRole("button", { name: "이전 질문", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "다음 질문", exact: true })).toHaveCount(0);
  expect(await calls(page)).toEqual({ advance: 0, save: 0 });
});

test("failed summary remains read only after consent expires while saved answers are reviewable", async ({
  page,
}) => {
  const before = await savedIntake(page, { needsConsent: true });
  await previousQuestion(page, 5);
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "합성 저장 질문 6", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toBeDisabled();
  expect(await calls(page)).toEqual({ advance: 0, save: 0 });
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
});

test("a conflicting saved-answer edit keeps the draft and disables the next action", async ({
  page,
}) => {
  const before = await savedIntake(page);
  await previousQuestion(page, 5);
  await page.evaluate(async () => {
    const casesPath = "/src/client/api/cases.ts";
    const corePath = "/src/client/api/core.ts";
    const { casesApi } = await import(casesPath);
    const { ApiError } = await import(corePath);
    casesApi.saveAnswers = async () => {
      localStorage.setItem("synthetic-review-save-calls", "1");
      throw new ApiError("CONFLICT", "합성 답변 충돌");
    };
  });
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  await editor.fill("충돌 뒤 보존할 합성 초안");
  await page.getByRole("button", { name: "저장하고 다음 질문", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "합성 답변 충돌" })).toBeVisible();
  await expect(editor).toHaveValue("충돌 뒤 보존할 합성 초안");
  await expect(
    page.getByRole("button", { name: "저장하고 다음 질문", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toEqual({ advance: 0, save: 1 });
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
});
