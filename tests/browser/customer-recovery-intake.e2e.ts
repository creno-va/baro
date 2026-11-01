import { expect, test } from "@playwright/test";
import { settleIntakeSave } from "../helpers/intake-autosave";

test("reconsent navigates every saved answer without saving or generating questions", async ({
  page,
}) => {
  const id = "readonly-intake-case";
  await page.addInitScript((caseId) => {
    const prefix = "baro-api-mock-v1:";
    const questions = [
      {
        id: "saved-answer",
        text: "저장한 첫 번째 질문",
        kind: "text",
        answerState: "answered",
        answer: "이미 저장한 합성 답변입니다.",
      },
      { id: "saved-unknown", text: "저장한 두 번째 질문", kind: "text", answerState: "unknown" },
      { id: "saved-skip", text: "저장한 세 번째 질문", kind: "text", answerState: "skipped" },
    ];
    const values = {
      session: {
        user: { id: "readonly-owner", name: "합성 검증 고객", accountType: "customer" },
        needsConsent: true,
      },
      cases: {
        [caseId]: {
          id: caseId,
          title: "저장한 질문 읽기 검증",
          subjectContext: "individual",
          stage: "intake",
          revision: 7,
          updatedAt: "2026-10-11T00:00:00.000Z",
          summary: "",
          schemaVersion: "2",
        },
      },
      caseOwners: { [caseId]: "readonly-owner" },
      intake: {
        [caseId]: {
          narrative: "저장한 질문과 답변의 읽기 권한을 검증하는 합성 사건입니다.",
          questions,
          rounds: [{ ordinal: 1, questionIds: questions.map((question) => question.id) }],
        },
      },
    };
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(prefix + key, JSON.stringify(value));
  }, id);
  await page.goto(`/cases/${id}/intake?edit=1&question=1`);
  await expect(page.getByRole("heading", { name: "저장한 두 번째 질문" })).toBeVisible();
  const before = await page.evaluate(async () => {
    const path = "/src/client/api/cases.ts";
    const { casesApi } = await import(path);
    const mutation = async () => {
      localStorage.setItem("readonly-mutation-attempt", "true");
      throw new Error("Readonly navigation must not mutate");
    };
    casesApi.saveAnswers = mutation;
    casesApi.advance = mutation;
    return ["cases", "intake", "caseRequests"].map((key) =>
      localStorage.getItem(`baro-api-mock-v1:${key}`),
    );
  });

  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByRole("heading", { name: "저장한 첫 번째 질문" })).toBeVisible();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await expect(answer).toHaveValue("이미 저장한 합성 답변입니다.");
  await expect(answer).toBeDisabled();
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "저장한 두 번째 질문" })).toBeVisible();
  await expect(page.getByText("모름으로 저장했어요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(page.getByRole("heading", { name: "저장한 세 번째 질문" })).toBeVisible();
  await expect(page.getByText(/^건너뛰기.*저장했어요\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 질문", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "모름", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "건너뛰기", exact: true })).toBeDisabled();
  const after = await page.evaluate(() => ({
    attemptedMutation: localStorage.getItem("readonly-mutation-attempt"),
    saved: ["cases", "intake", "caseRequests"].map((key) =>
      localStorage.getItem(`baro-api-mock-v1:${key}`),
    ),
  }));
  expect(after.attemptedMutation).toBeNull();
  expect(after.saved).toEqual(before);
});

for (const state of ["unknown", "skipped"] as const)
  for (const errorRetry of [false, true])
    test(`edit answer after failed ${state}; error retry=${errorRetry}`, async ({ page }) => {
      await page.addInitScript(() =>
        localStorage.setItem(
          "baro-api-mock-v1:session",
          JSON.stringify({
            user: { id: "answer-retry-owner", name: "합성 검증 고객", accountType: "customer" },
            needsConsent: false,
          }),
        ),
      );
      await page.goto("/cases/new");
      await page
        .getByLabel("지금까지 있었던 일")
        .fill(
          "질문 답변의 실패 후 수정과 재시도를 검증하는 합성 사건입니다. 거래 날짜를 확인합니다.",
        );
      await page.getByRole("button", { name: "저장하고 계속" }).click();
      const answer = page.getByRole("textbox", { name: "답변", exact: true });
      await answer.fill("저장하기 전 합성 답변입니다.");
      await page.evaluate(async () => {
        const path = "/src/client/api/cases.ts",
          core = "/src/client/api/core.ts";
        const { casesApi } = await import(path),
          { ApiError } = await import(core);
        const original = casesApi.saveAnswers;
        casesApi.saveAnswers = async () => {
          casesApi.saveAnswers = original;
          throw new ApiError("UNAVAILABLE", "합성 저장 장애", true);
        };
      });
      await page
        .getByRole("button", { name: state === "unknown" ? "모름" : "건너뛰기", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("합성 저장 장애");
      const replacement = "오류 뒤 새로 입력한 실제 저장 대상 합성 답변입니다.";
      await answer.fill(replacement);
      if (errorRetry) await page.getByRole("button", { name: "다시 시도", exact: true }).click();
      else await page.getByRole("button", { name: "저장하고 다음 질문", exact: true }).click();
      await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
      const saved = await page.evaluate(async () => {
        const path = "/src/client/api/index.ts",
          { api } = await import(path);
        return (await api.cases.getQuestions(location.pathname.split("/")[2])).questions[0];
      });
      expect(saved.answerState).toBe("answered");
      expect(saved.answer).toBe(replacement);
    });

test("previous question navigation preserves the unsaved current answer", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "more-review-customer", name: "합성 검증 고객", accountType: "customer" },
        needsConsent: false,
      }),
    ),
  );
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("이전 질문 이동을 검토하는 합성 사건입니다. 거래 날짜와 약속 내용을 정리합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  await editor.fill("아직 저장하지 않은 두 번째 질문의 합성 초안입니다.");

  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("아직 저장하지 않은 두 번째 질문의 합성 초안입니다.");
});

test("previous question navigation forgets a draft restored to its saved answer", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "restored-draft-customer", name: "합성 검증 고객", accountType: "customer" },
        needsConsent: false,
      }),
    ),
  );
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("저장한 답변으로 되돌린 초안을 검증하는 합성 사건입니다. 거래 날짜를 확인합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  const saved = "이미 저장한 두 번째 합성 답변입니다.";
  const discarded = "나중에 버릴 두 번째 답변의 합성 초안입니다.";
  await editor.fill(saved);

  await settleIntakeSave(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const records = JSON.parse(localStorage.getItem("baro-api-mock-v1:intake") ?? "{}");
        return (Object.values(records) as { questions: { answer?: string }[] }[])[0]?.questions[1]
          ?.answer;
      }),
    )
    .toBe(saved);

  await editor.fill(discarded);
  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(editor).toHaveValue(discarded);

  await editor.fill(saved);

  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(saved);
});

test("acknowledged autosave recovery keeps the current question and earlier saved answers", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "hidden-draft-customer", name: "합성 검증 고객", accountType: "customer" },
        needsConsent: false,
      }),
    ),
  );
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("다른 질문의 초안을 남긴 상태에서 저장 응답 복구를 검증하는 합성 사건입니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  const hiddenDraft = "두 번째 질문에 남겨 둔 미저장 합성 초안입니다.";
  const savedAnswer = "세션 확인 전에 저장된 첫 번째 합성 답변입니다.";
  await editor.fill(hiddenDraft);

  await page.getByRole("button", { name: "이전으로", exact: true }).click();
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await editor.fill(savedAnswer);
  await page.evaluate(async () => {
    const apiPath = "/src/client/api/index.ts";
    const casesPath = "/src/client/api/cases.ts";
    const corePath = "/src/client/api/core.ts";
    const { api } = await import(apiPath);
    const { casesApi } = await import(casesPath);
    const { ApiError } = await import(corePath);
    const state = { saves: 0, sessionFailures: 0 };
    (window as unknown as { hiddenDraftRecovery: typeof state }).hiddenDraftRecovery = state;
    let failPostflight = false;
    const save = casesApi.saveAnswers.bind(casesApi);
    casesApi.saveAnswers = async (id: string, input: unknown) => {
      ++state.saves;
      const next = await save(id, input);
      if (state.saves === 1) failPostflight = true;
      return next;
    };
    const session = api.session.get.bind(api.session);
    api.session.get = async () => {
      if (failPostflight) {
        failPostflight = false;
        ++state.sessionFailures;
        throw new ApiError("UNAVAILABLE", "합성 저장 후 세션 확인 장애", true);
      }
      return session();
    };
  });

  await settleIntakeSave(page);
  await expect(page.getByRole("alert")).toContainText("합성 저장 후 세션 확인 장애");
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue(savedAnswer);
  const result = await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = await import(path);
    return {
      counters: (
        window as unknown as { hiddenDraftRecovery: { saves: number; sessionFailures: number } }
      ).hiddenDraftRecovery,
      questions: (await api.cases.getQuestions(location.pathname.split("/")[2])).questions,
    };
  });
  expect(result.counters).toEqual({ saves: 1, sessionFailures: 1 });
  expect(result.questions[0].answer).toBe(savedAnswer);
  expect(result.questions[1].answerState).toBe("answered");
  expect(result.questions[1].answer).toBe(hiddenDraft);
  await page.getByRole("button", { name: "다음 질문", exact: true }).click();
  await expect(editor).toHaveValue(hiddenDraft);
});

// The retired raw-summary save/confirm and peer-draft tests are replaced by
// intake-reconfirmation.e2e.ts: explanation preservation, acknowledged/uncertain
// confirmation recovery, late reads, owner purge and exact proposal CAS.
