import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { casesApi } from "../src/client/api/cases";
import { ApiError } from "../src/client/api/core";
import { casesMockHandlers as handlers } from "../src/client/api/mock/cases";
import { clearMockStore, readStore, writeStore } from "../src/client/api/mock/runtime";
import type { CaseView } from "../src/client/api/types";

const narrative = "합성 사건: 지난달 지인에게 돈을 빌려줬지만 약속한 날짜에 돌려받지 못했습니다.";
const session = (id = "synthetic-customer") =>
  writeStore("session", {
    user: { id, name: "예시 고객", accountType: "customer" },
    needsConsent: false,
  });
const context = () => ({ key: crypto.randomUUID() });
beforeEach(() => {
  clearMockStore();
  session();
});
afterEach(() => {
  clearMockStore();
});
describe("B persistent API mock", () => {
  test("empty/create/partial save/resume/back edit/unknown/skip/summary/confirm share the same case", () => {
    expect(handlers["cases.list"]()).toEqual([]);
    const item = handlers["cases.create"](
      { narrative, subjectContext: "individual" },
      context(),
    ) as CaseView;
    let questions = handlers["cases.getQuestions"]({ id: item.id });
    expect(questions.questions).toHaveLength(2);
    expect(questions.followupLimit).toBe(2);
    const first = questions.questions[0];
    if (!first) throw new Error();
    questions = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: questions.revision,
        answers: [{ questionId: first.id, state: "answered", value: "2026년 9월" }],
      },
      context(),
    );
    expect(questions.complete).toBe(false);
    expect(handlers["cases.getQuestions"]({ id: item.id }).questions[0]?.answer).toBe("2026년 9월");
    questions = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: questions.revision,
        answers: [{ questionId: first.id, state: "answered", value: "2026년 8월" }],
      },
      context(),
    );
    for (const [index, q] of questions.questions.entries()) {
      if (index === 0) continue;
      const state = index === 1 ? "unknown" : index === 2 ? "answered" : "skipped";
      questions = handlers["cases.saveAnswers"](
        {
          id: item.id,
          expectedRevision: questions.revision,
          answers: [
            { questionId: q.id, state, ...(state === "answered" ? { value: q.options?.[0] } : {}) },
          ],
        },
        context(),
      );
    }
    questions = handlers["cases.advance"](
      { id: item.id, expectedRevision: questions.revision },
      context(),
    );
    expect(questions.complete).toBe(true);
    let summary = handlers["cases.get"]({ id: item.id });
    expect(summary.summary).toContain("2026년 8월");
    expect(summary.summary).toContain("모름");
    summary = handlers["cases.saveSummary"](
      {
        id: item.id,
        expectedRevision: summary.revision,
        summary: "합성 사건의 수정한 요약입니다.",
      },
      context(),
    ) as CaseView;
    const confirmed = handlers["cases.confirmSummary"](
      { id: item.id, expectedRevision: summary.revision },
      context(),
    ) as CaseView;
    expect(confirmed.stage).toBe("active");
    expect(readStore<Record<string, CaseView>>("cases", {})[item.id]?.summary).toBe(
      "합성 사건의 수정한 요약입니다.",
    );
  });
  test("stale revisions, invalid choices, missing answers, consent/ownership and deletion fail closed", () => {
    const item = handlers["cases.create"](
      { narrative, subjectContext: "company" },
      context(),
    ) as CaseView;
    const q = handlers["cases.getQuestions"]({ id: item.id });
    expect(() =>
      handlers["cases.advance"]({ id: item.id, expectedRevision: 1 }, context()),
    ).toThrow(ApiError);
    expect(() =>
      handlers["cases.saveAnswers"](
        {
          id: item.id,
          expectedRevision: 99,
          answers: [{ questionId: q.questions[0]?.id, state: "unknown" }],
        },
        context(),
      ),
    ).toThrow(ApiError);
    expect(() =>
      handlers["cases.saveAnswers"](
        {
          id: item.id,
          expectedRevision: 1,
          answers: [{ questionId: "missing-question", state: "answered", value: "없는 선택" }],
        },
        context(),
      ),
    ).toThrow(ApiError);
    session("another-customer");
    expect(handlers["cases.list"]()).toHaveLength(0);
    expect(() => handlers["cases.get"]({ id: item.id })).toThrow(ApiError);
    session();
    writeStore("cases", {});
    expect(() => handlers["cases.get"]({ id: item.id })).toThrow(ApiError);
    writeStore("session", {
      user: { id: "synthetic-customer", name: "예시", accountType: "customer" },
      needsConsent: true,
    });
    expect(() => handlers["cases.list"]()).toThrow(ApiError);
  });
  test("mutation replay persists across handler calls and changed payload cannot reuse a key", () => {
    const key = context(),
      input = { narrative, subjectContext: "individual" };
    const first = handlers["cases.create"](input, key) as CaseView;
    const again = handlers["cases.create"](input, key) as CaseView;
    expect(first.id).toBe(again.id);
    expect(handlers["cases.list"]()).toHaveLength(1);
    expect(() =>
      handlers["cases.create"]({ ...input, narrative: `${narrative} 수정` }, key),
    ).toThrow(ApiError);
  });
  test("mock quota matches the fixed v2 allowance without changing existing cases", () => {
    for (let index = 0; index < 3; index++)
      handlers["cases.create"](
        { narrative: `${narrative} ${index}`, subjectContext: "individual" },
        context(),
      );
    expect(() =>
      handlers["cases.create"]({ narrative, subjectContext: "individual" }, context()),
    ).toThrow(ApiError);
    expect(handlers["cases.list"]()).toHaveLength(3);
  });
  test("editing a prior answer invalidates the generated summary", () => {
    const item = handlers["cases.create"](
      { narrative, subjectContext: "individual" },
      context(),
    ) as CaseView;
    let q = handlers["cases.getQuestions"]({ id: item.id });
    q = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: 1,
        answers: q.questions.map((v) => ({ questionId: v.id, state: "unknown" })),
      },
      context(),
    );
    q = handlers["cases.advance"]({ id: item.id, expectedRevision: q.revision }, context());
    q = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: q.revision,
        answers: [{ questionId: q.questions[0]?.id, state: "answered", value: "내용 수정" }],
      },
      context(),
    );
    expect(q.complete).toBe(false);
    expect(handlers["cases.get"]({ id: item.id }).summary).toBe("");
  });
  test("stored legacy questions remain editable and retain unknown, skipped and choice answers", () => {
    const item = handlers["cases.create"]({ narrative, subjectContext: "individual" }, context());
    const saved = readStore<
      Record<
        string,
        { narrative: string; questions: import("../src/client/api/types").QuestionView[] }
      >
    >("intake", {});
    const intake = saved[item.id];
    if (!intake) throw new Error("Missing intake");
    intake.questions.push(
      { id: "legacy-choice", kind: "choice", text: "자료가 있나요?", options: ["예", "아니오"] },
      { id: "legacy-text", kind: "text", text: "서로 다르게 기억하는 내용이 있나요?" },
    );
    writeStore("intake", saved);
    let result = handlers["cases.getQuestions"]({ id: item.id });
    expect(result.questions).toHaveLength(4);
    expect(() =>
      handlers["cases.saveAnswers"](
        {
          id: item.id,
          expectedRevision: result.revision,
          answers: [{ questionId: "legacy-choice", state: "answered", value: "없는 선택" }],
        },
        context(),
      ),
    ).toThrow(ApiError);
    result = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: result.revision,
        answers: result.questions.map((q, index) => ({
          questionId: q.id,
          state: index === 0 ? "unknown" : "skipped",
        })),
      },
      context(),
    );
    result = handlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: result.revision,
        answers: [{ questionId: "legacy-choice", state: "answered", value: "예" }],
      },
      context(),
    );
    result = handlers["cases.advance"](
      { id: item.id, expectedRevision: result.revision },
      context(),
    );
    expect(result.questions).toHaveLength(4);
    expect(result.complete).toBe(true);
    expect(handlers["cases.get"]({ id: item.id }).summary).toContain("모름");
    expect(handlers["cases.get"]({ id: item.id }).summary).toContain("건너뛰기");
  });
});

describe("PR100 real wire mapping", () => {
  const id = "11111111-1111-4111-8111-111111111111",
    now = "2026-10-06T11:00:00.000Z";
  const w = {
    schemaVersion: "2",
    id,
    title: "사건 작업 공간",
    subjectContext: "individual",
    jurisdiction: "KR",
    status: "intake",
    archivedFrom: null,
    workspaceRevision: 5,
    intakeRevision: 3,
    confirmedSummaryRevision: null,
    currentJobId: null,
    legacySnapshotId: null,
    createdAt: now,
    updatedAt: now,
  };
  const m = {
    schemaVersion: "2",
    revision: 3,
    status: "reviewing_summary",
    narrative,
    batches: [],
    confirmedSummaryRevision: null,
    currentJobId: null,
    summary: { id: "summary-1", revision: 2 },
  };
  const summary = {
    schemaVersion: "2",
    revision: 2,
    intakeRevision: 3,
    createdAt: now,
    overview: "합성 요약",
    facts: [],
    parties: [],
    unknowns: [],
    notices: ["사실 확인이 필요해요."],
  };
  let original: typeof fetch;
  const writes: { url: string; body: unknown; key: string | null }[] = [];
  beforeEach(() => {
    original = globalThis.fetch;
    writes.length = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (String(input).endsWith("/workspace-jobs/latest")) return Response.json(null);
      if (String(input) === "/api/me/session")
        return Response.json({
          user: { id: "synthetic-summary-owner", accountType: "customer" },
          needsConsent: false,
        });
      if (init?.method && init.method !== "GET")
        writes.push({
          url,
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("idempotency-key"),
        });
      const body =
        url.endsWith("/workspace") || url.endsWith("/confirm")
          ? w
          : url.endsWith("/summary") && (!init?.method || init.method === "GET")
            ? summary
            : m;
      return Response.json(body);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
  });
  test("overview edits use summary revision and confirmations use intake/summary revisions", async () => {
    const saveSummary = casesApi.saveSummary,
      confirmSummary = casesApi.confirmSummary;
    await saveSummary(id, { expectedRevision: 5, summary: "수정된 합성 요약" });
    expect(writes[0]?.body).toEqual({ expectedRevision: 2, overview: "수정된 합성 요약" });
    await confirmSummary(id, { expectedRevision: 5 });
    expect(writes[1]?.body).toEqual({ expectedRevision: 3, summaryRevision: 2 });
    expect(writes.every((write) => !!write.key)).toBe(true);
    await expect(casesApi.confirmSummary(id, { expectedRevision: 4 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  test("partial answer state becomes PR100 status and retains same request key on retry", async () => {
    const input = {
      expectedRevision: 5,
      answers: [{ questionId: "question-1", state: "unknown" as const }],
    };
    await casesApi.saveAnswers(id, input);
    await casesApi.saveAnswers(id, input);
    expect(writes[0]?.body).toEqual({
      expectedRevision: 3,
      answers: [{ questionId: "question-1", status: "unknown" }],
    });
    expect(writes[0]?.key).toBe(writes[1]?.key);
  });
  for (const count of [2, 5])
    test(`failed old question jobs with ${count} saved questions advance to summary and preserve answers`, async () => {
      const transport = globalThis.fetch;
      const questions = Array.from({ length: count }, (_, index) => ({
        id: `saved-${index}`,
        prompt: `저장한 질문 ${index}`,
        answerType: "text",
        options: [],
      }));
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.endsWith("/intake"))
          return Response.json({
            ...m,
            status: "collecting",
            summary: null,
            currentJobId: "failed-questions",
            batches: [
              {
                id: "saved-batch",
                ordinal: 1,
                generatedForIntakeRevision: 1,
                questions,
                answers: questions.map((q) => ({ questionId: q.id, status: "skipped" })),
              },
            ],
          });
        if (url.endsWith("/workspace-jobs/failed-questions"))
          return Response.json({ status: "failed", retryable: false, kind: "intake_questions" });
        return transport(input, init);
      }) as typeof fetch;
      const result = await casesApi.advance(id, { expectedRevision: 5 });
      expect(writes[0]?.url).toBe(`/api/v2/cases/${id}/intake/advance`);
      expect(result.followupLimit).toBe(2);
      expect(result.processingStage).toBe("summary");
      expect(result.questions).toHaveLength(count);
      expect(result.questions.every((q) => q.answerState === "skipped")).toBe(true);
    });
});
