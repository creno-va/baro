import { expect, type Page, test } from "@playwright/test";

// Synthetic local UI regression only. Adapter counters replace generation;
// these tests never create a real job or represent external AI success.
async function savedIntake(
  page: Page,
  options: {
    retryable?: boolean;
    processing?: boolean;
    needsConsent?: boolean;
    failed?: boolean;
    rounds?: 1 | 2;
    answerState?: "answered" | "unknown" | "skipped";
    choice?: boolean;
    complete?: boolean;
  } = {},
) {
  const caseId = "synthetic-saved-review";
  const count = (options.rounds ?? 2) * 3;
  await page.addInitScript(
    ({ id, needsConsent, count, answerState, choice }) => {
      const owner = "synthetic-saved-review-owner";
      const questions = Array.from({ length: count }, (_, index) => ({
        id: `saved-${index}`,
        text: `합성 저장 질문 ${index + 1}`,
        kind: "text",
        answerState: "answered",
        answer: `합성 저장 답변 ${index + 1}`,
      }));
      const last = questions.at(-1);
      if (last) {
        last.answerState = answerState;
        last.answer = answerState === "answered" ? (choice ? "선택 A" : last.answer) : "";
        if (choice) Object.assign(last, { kind: "choice", options: ["선택 A", "선택 B"] });
      }
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
            rounds: Array.from({ length: count / 3 }, (_, index) => ({
              ordinal: index + 1,
              questionIds: questions.slice(index * 3, index * 3 + 3).map((q) => q.id),
            })),
          },
        },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
      // Preserve evidence when a completed response navigates to the summary document.
      for (const key of ["synthetic-review-advance-calls", "synthetic-review-save-calls"])
        if (localStorage.getItem(key) === null) localStorage.setItem(key, "0");
    },
    {
      id: caseId,
      needsConsent: options.needsConsent ?? false,
      count,
      answerState: options.answerState ?? "answered",
      choice: options.choice ?? false,
    },
  );
  const state = {
    failed: options.failed ?? !options.processing,
    retryable: options.retryable ?? true,
    failure: options.processing || options.failed === false ? null : "POLICY_REJECTED",
    processing: options.processing ?? false,
    processingStage: count === 6 ? "summary" : "questions",
    ...(options.complete === undefined ? {} : { complete: options.complete }),
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
casesApi.advance = async (id, input) => {
  localStorage.setItem("synthetic-review-advance-calls", String(Number(localStorage.getItem("synthetic-review-advance-calls")) + 1));
  localStorage.setItem("synthetic-review-advance-revision", String(input.expectedRevision));
  return casesApi.getQuestions(id);
};
casesApi.saveAnswers = async (...args) => {
  localStorage.setItem("synthetic-review-save-calls", String(Number(localStorage.getItem("synthetic-review-save-calls")) + 1));
  return { ...await syntheticReviewSave(...args), ...syntheticReviewState };
};
`,
    });
  });
  await page.goto(
    `/cases/${caseId}/intake?question=${count - 1}${options.complete ? "&edit=1" : ""}`,
  );
  await expect(
    page.getByRole("heading", { name: `합성 저장 질문 ${count}`, exact: true }),
  ).toBeVisible();
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

for (const rounds of [1, 2] as const) {
  test(`clean saved round ${rounds} boundary advances once without saving again`, async ({
    page,
  }) => {
    const before = await savedIntake(page, { failed: false, rounds });
    await page
      .getByRole("button", { name: /^(저장하고 )?(요약 보기|2차 질문 보기|다음 질문 준비하기)$/ })
      .click();
    await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 0 });
    expect(
      await page.evaluate(() => localStorage.getItem("synthetic-review-advance-revision")),
    ).toBe("12");
    expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
    await expect(
      page.getByRole("button", {
        name: rounds === 2 ? "요약 보기" : "다음 질문 준비하기",
        exact: true,
      }),
    ).toBeVisible();
  });
}

async function calls(page: Page) {
  return page.evaluate(() => ({
    advance: Number(localStorage.getItem("synthetic-review-advance-calls")),
    save: Number(localStorage.getItem("synthetic-review-save-calls")),
  }));
}

for (const answer of ["unknown", "skipped", "choice"] as const) {
  test(`clean saved ${answer} final answer advances without a write`, async ({ page }) => {
    const before = await savedIntake(page, {
      failed: false,
      ...(answer === "choice" ? { choice: true } : { answerState: answer }),
    });
    await page.getByRole("button", { name: "요약 보기", exact: true }).click();
    await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 0 });
    expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:intake"))).toBe(before);
  });
}

for (const change of ["text", "choice", "unknown", "skipped"] as const) {
  test(`changed ${change} final answer still saves before advancing`, async ({ page }) => {
    await savedIntake(page, { failed: false, choice: change === "choice" });
    if (change === "unknown" || change === "skipped") {
      await page
        .getByRole("button", { name: change === "unknown" ? "모름" : "건너뛰기", exact: true })
        .click();
    } else {
      if (change === "choice")
        await page.getByRole("radio", { name: "선택 B", exact: true }).check();
      else
        await page
          .getByRole("textbox", { name: "답변", exact: true })
          .fill("수정된 마지막 합성 답변");
      await page.getByRole("button", { name: "저장하고 요약 보기", exact: true }).click();
    }
    await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 1 });
    expect(
      await page.evaluate(() => localStorage.getItem("synthetic-review-advance-revision")),
    ).toBe("13");
  });
}

test("editing an already completed summary keeps its existing invalidation path", async ({
  page,
}) => {
  await savedIntake(page, { failed: false, complete: true });
  await expect(page.getByRole("button", { name: "요약 보기", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "저장하고 요약 보기", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 1 });
});

for (const change of ["owner", "consent"] as const) {
  test(`clean final advance rechecks ${change} before mutation`, async ({ page }) => {
    await savedIntake(page, { failed: false });
    await page.evaluate((change) => {
      const session = JSON.parse(localStorage.getItem("baro-api-mock-v1:session") ?? "null");
      if (change === "owner") session.user.id = "synthetic-other-owner";
      else session.needsConsent = true;
      localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
    }, change);
    await page.getByRole("button", { name: "요약 보기", exact: true }).click();
    if (change === "owner")
      await expect(
        page.getByRole("heading", { name: "합성 저장 질문 6", exact: true }),
      ).toHaveCount(0);
    else await expect(page.getByRole("link", { name: "동의 확인", exact: true })).toBeVisible();
    expect(await calls(page)).toEqual({ advance: 0, save: 0 });
  });
}

test("clean final admission failure retries only advance with the same revision", async ({
  page,
}) => {
  await savedIntake(page, { failed: false });
  await page.evaluate(async () => {
    const casesPath = "/src/client/api/cases.ts";
    const corePath = "/src/client/api/core.ts";
    const { casesApi } = await import(casesPath);
    const { ApiError } = await import(corePath);
    const original = casesApi.advance;
    let first = true;
    casesApi.advance = async (...args: Parameters<typeof original>) => {
      const value = await original(...args);
      if (first) {
        first = false;
        throw new ApiError("UNAVAILABLE", "합성 작업 접수 연결 실패", true);
      }
      return value;
    };
  });
  await page.getByRole("button", { name: "요약 보기", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "합성 작업 접수 연결 실패" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "저장하고 요약 보기", exact: true }),
  ).toBeDisabled();
  await page
    .locator("form")
    .evaluate((form) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  expect(await calls(page)).toEqual({ advance: 1, save: 0 });
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual({ advance: 2, save: 0 });
  expect(await page.evaluate(() => localStorage.getItem("synthetic-review-advance-revision"))).toBe(
    "12",
  );
});

test("clean final revision conflict requires explicit refresh without saving", async ({ page }) => {
  await savedIntake(page, { failed: false });
  await page.evaluate(async () => {
    const casesPath = "/src/client/api/cases.ts";
    const corePath = "/src/client/api/core.ts";
    const { casesApi } = await import(casesPath);
    const { ApiError } = await import(corePath);
    const original = casesApi.advance;
    casesApi.advance = async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new ApiError("CONFLICT", "합성 최신 답변 충돌");
    };
  });
  await page.getByRole("button", { name: "요약 보기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "합성 최신 답변 충돌" })).toBeVisible();
  await expect(page.getByRole("button", { name: "최신 내용 불러오기", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "저장하고 요약 보기", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toEqual({ advance: 1, save: 0 });
});

test("pending clean final advance locks repeated submission and ignores a signed-out response", async ({
  page,
}) => {
  await savedIntake(page, { failed: false });
  await page.evaluate(async () => {
    const casesPath = "/src/client/api/cases.ts";
    const { casesApi } = await import(casesPath);
    const original = casesApi.advance;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseSyntheticAdvance: release });
    casesApi.advance = async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      await gate;
      return result;
    };
  });
  await page.getByRole("button", { name: "요약 보기", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual({ advance: 1, save: 0 });
  await expect(
    page.getByRole("status").filter({ hasText: "사건 요약을 정리하고 있어요" }),
  ).toBeVisible();
  await page
    .locator("form")
    .evaluate((form) =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  expect(await calls(page)).toEqual({ advance: 1, save: 0 });
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({ user: null, needsConsent: false }),
    );
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    );
    Reflect.get(window, "releaseSyntheticAdvance")();
  });
  await expect(page.getByRole("heading", { name: "합성 저장 질문 6", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toBeVisible();
  expect(await calls(page)).toEqual({ advance: 1, save: 0 });
});

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
