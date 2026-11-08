import { afterEach, beforeEach, expect, test } from "bun:test";
import { casesMockHandlers as cases } from "../src/client/api/mock/cases";
import { createReworkMock } from "../src/client/api/mock/rework";
import { clearMockStore, mockRuntime, readStore, writeStore } from "../src/client/api/mock/runtime";
import type { WorkspaceMockState } from "../src/client/api/mock/workspace";
import type { QuestionView } from "../src/client/api/types";
import { EXPECTED_OWNER_HEADER } from "../src/contracts/session";
import { v2ReworkCreateCaseResponseSchema } from "../src/contracts/v2";

const ownerId = "synthetic-question-owner";
const narrative =
  "합성 검증 사건입니다. 받은 문서는 없고 구체적인 상대방 주장과 날짜는 아직 확인하지 못했습니다.";
const claimPrompts = ["상대방은 어떤 내용을 주장하나요?", "상대방은 이 일에 대해 뭐라고 했나요?"];
type StoredIntake = {
  narrative: string;
  questions: QuestionView[];
  rounds: { ordinal: number; questionIds: string[] }[];
};
const requestKey = () => ({ key: crypto.randomUUID() });
function session(
  accountType: "customer" | "lawyer" = "customer",
  id = ownerId,
  needsConsent = false,
) {
  writeStore("session", { user: { id, name: "합성 사용자", accountType }, needsConsent });
}
beforeEach(() => {
  clearMockStore();
  session();
});
afterEach(clearMockStore);

async function start(kind: "civil" | "criminal", purpose: "prepare_claim" | "respond_to_claim") {
  const handle = createReworkMock({
    read: () => mockRuntime.read() as WorkspaceMockState,
    update: (mutate) => mockRuntime.update((state) => mutate(state as WorkspaceMockState)),
  });
  const request = async (path: string, method: string, body: unknown) => {
    const response = await handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          [EXPECTED_OWNER_HEADER]: ownerId,
        },
        body: JSON.stringify(body),
      }),
    );
    if (!response) throw new Error("Missing existing synthetic rework route");
    return response;
  };
  const response = await request("/api/v2/cases/rework", "POST", {
    narrative,
    casePurpose: purpose,
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
  expect(response.status).toBe(201);
  const made = v2ReworkCreateCaseResponseSchema.parse(await response.json());
  const id = made.workspace.id;
  const updated = await request(`/api/v2/cases/${id}/rework/context`, "PUT", {
    expectedRevision: made.workspace.workspaceRevision,
    casePurpose: purpose,
    subjectContext: "individual",
    procedure: { kind, stage: "unconfirmed", description: null },
  });
  expect(updated.status).toBe(200);
  return id;
}

function saveFirst(id: string, state: "answered" | "unknown" | "skipped") {
  const first = cases["cases.getQuestions"]({ id });
  return cases["cases.saveAnswers"](
    {
      id,
      expectedRevision: first.revision,
      answers: first.questions.map((q, index) =>
        index === 1 && state === "answered"
          ? {
              questionId: q.id,
              state,
              value: "구체적인 주장은 아직 확인하지 못했고 제 설명과 다른 부분이 있어요.",
            }
          : { questionId: q.id, state: index === 1 ? state : "unknown" },
      ),
    },
    requestKey(),
  );
}

for (const state of ["answered", "unknown", "skipped"] as const)
  test(`response follow-up does not rephrase a previously ${state} allegation`, async () => {
    const id = await start("criminal", "respond_to_claim");
    const saved = saveFirst(id, state);
    expect(saved.questions[1]?.text).toBe(claimPrompts[0]);
    const before = structuredClone(saved.questions);
    const second = cases["cases.advance"]({ id, expectedRevision: saved.revision }, requestKey());
    const fresh = second.questions.slice(before.length);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(3);
    expect(fresh.some((q) => claimPrompts.includes(q.text))).toBe(false);
    expect(second.questions.slice(0, before.length)).toEqual(before);
    expect(readStore<Record<string, StoredIntake>>("intake", {})[id]?.narrative).toBe(narrative);
  });

for (const kind of ["civil", "criminal"] as const)
  for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
    test(`${kind}/${purpose} keeps existing intake shape, explicit saves and the two-round cap`, async () => {
      const id = await start(kind, purpose);
      const initial = cases["cases.getQuestions"]({ id });
      expect(() =>
        cases["cases.advance"]({ id, expectedRevision: initial.revision }, requestKey()),
      ).toThrow();
      expect(cases["cases.getQuestions"]({ id })).toEqual(initial);
      const saved = saveFirst(id, "unknown");
      const snapshot = structuredClone(saved.questions);
      const input = { id, expectedRevision: saved.revision },
        key = requestKey();
      const second = cases["cases.advance"](input, key);
      expect(second.rounds).toHaveLength(2);
      expect(second.roundLimit).toBe(2);
      for (const round of second.rounds) {
        expect(round.questionIds.length).toBeGreaterThan(0);
        expect(round.questionIds.length).toBeLessThanOrEqual(3);
      }
      expect(second.questions.length).toBeLessThanOrEqual(6);
      expect(second.questions.slice(0, snapshot.length)).toEqual(snapshot);
      const fresh = second.questions.slice(snapshot.length);
      expect(fresh.some((q) => claimPrompts.includes(q.text))).toBe(purpose === "prepare_claim");
      expect(new Set(second.questions.map((q) => q.id)).size).toBe(second.questions.length);
      expect(cases["cases.advance"](input, key)).toEqual(second);
      expect(cases["cases.getQuestions"]({ id })).toEqual(second);
      for (const q of fresh) expect(q).not.toHaveProperty("topic");
      expect(
        Object.keys(readStore<Record<string, StoredIntake>>("intake", {})[id] ?? {}).sort(),
      ).toEqual(["narrative", "questions", "rounds"]);
      const completed = cases["cases.saveAnswers"](
        {
          id,
          expectedRevision: second.revision,
          answers: fresh.map((q) => ({ questionId: q.id, state: "skipped" })),
        },
        requestKey(),
      );
      const summary = cases["cases.advance"](
        { id, expectedRevision: completed.revision },
        requestKey(),
      );
      expect(summary.complete).toBe(true);
      expect(summary.rounds).toHaveLength(2);
      expect(summary.questions.slice(0, snapshot.length)).toEqual(snapshot);
    });

for (const count of [3, 5])
  test(`stored legacy batch of ${count} keeps its answers and selects only unasked fixed questions`, async () => {
    const id = await start("civil", "prepare_claim");
    const records = readStore<Record<string, StoredIntake>>("intake", {});
    const stored = records[id];
    if (!stored) throw new Error("Missing synthetic intake");
    stored.questions = [
      "  상대방은 이 일에 대해 뭐라고 했나요！？  ",
      "확인할 수 있는 자료가 있나요?",
      "내 입장에 불리하거나, 서로 다르게 기억하는 내용이 있나요?",
      "이 일에 대해 이미 답하거나 대응한 일이 있나요?",
      "이 일을 직접 보거나 들은 사람이 있나요?",
    ]
      .slice(0, count)
      .map((text) => ({
        id: crypto.randomUUID(),
        kind: "text",
        text,
        answerState: "unknown",
      }));
    stored.rounds = [{ ordinal: 1, questionIds: stored.questions.map((q) => q.id) }];
    writeStore("intake", records);
    const before = structuredClone(stored.questions);
    const current = cases["cases.getQuestions"]({ id });
    const second = cases["cases.advance"]({ id, expectedRevision: current.revision }, requestKey());
    expect(second.questions.slice(0, before.length)).toEqual(before);
    const fresh = second.questions.slice(before.length);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(3);
    expect(fresh.some((q) => before.some((prior) => prior.text === q.text))).toBe(false);
    expect(fresh.some((q) => claimPrompts.includes(q.text))).toBe(false);
    if (count === 5) {
      expect(fresh).toHaveLength(1);
      expect(fresh[0]?.text).toBe(
        "말씀하신 내용 중 직접 겪은 일과 전해 들은 일이 있다면 구분해 주세요.",
      );
    }
  });

for (const accountType of ["customer", "lawyer"] as const)
  test(`question selection preserves ${accountType} ownership and consent boundaries`, async () => {
    session(accountType);
    const id = await start("criminal", "respond_to_claim");
    const saved = saveFirst(id, "unknown");
    const records = readStore("intake", {});
    session(accountType, "another-synthetic-owner");
    expect(() => cases["cases.getQuestions"]({ id })).toThrow("사건을 찾을 수 없어요.");
    expect(() =>
      cases["cases.advance"]({ id, expectedRevision: saved.revision }, requestKey()),
    ).toThrow("사건을 찾을 수 없어요.");
    expect(readStore("intake", {})).toEqual(records);
    session(accountType, ownerId, true);
    expect(cases["cases.getQuestions"]({ id }).questions).toEqual(saved.questions);
    expect(() =>
      cases["cases.advance"]({ id, expectedRevision: saved.revision }, requestKey()),
    ).toThrow("시작 전에 필수 확인을 완료해 주세요.");
    expect(readStore("intake", {})).toEqual(records);
    session(accountType);
    expect(
      cases["cases.advance"]({ id, expectedRevision: saved.revision }, requestKey()).rounds,
    ).toHaveLength(2);
  });
