import { expect, test } from "bun:test";
import { ApiError, answersInputSchema, type QuestionsResult } from "@baro/api-client";
import type { CaseView } from "@baro/client-core";
import { createCasesModel } from "../apps/mobile/src/features/cases/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { summary } from "./fixtures/contracts/v2";

const owner = (id = "a"): SessionState => ({
  phase: "ready",
  busy: false,
  role: "customer",
  session: { user: { id, name: "합성 계정", accountType: "customer" }, needsConsent: false },
  consent: null,
  error: null,
});
const narrative = "계약과 대화의 날짜를 정리해서 상담을 준비하려는 합성 사건입니다.";
const base: CaseView = {
  id: "case_a",
  schemaVersion: "2",
  title: "합성 사건",
  subjectContext: "individual",
  revision: 1,
  stage: "intake",
  summary: "",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
async function settled() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
function fixture() {
  let session = owner(),
    item = { ...base },
    delay: Promise<void> | undefined,
    getDelay: Promise<void> | undefined,
    reads = 0,
    failQuestions = false,
    calls = 0,
    refreshes = 0,
    confirmations = 0,
    advances = 0;
  let questions: QuestionsResult = {
    questions: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `q${n}`,
      text: `합성 질문 ${n}`,
      kind: "text",
    })),
    rounds: [
      { ordinal: 1, questionIds: ["q1", "q2", "q3"] },
      { ordinal: 2, questionIds: ["q4", "q5", "q6"] },
    ],
    revision: 1,
    complete: false,
    roundLimit: 2,
  };
  const listeners = new Set<() => void>(),
    saved: string[][] = [];
  let poll: (() => void) | undefined;
  const setSession = (next: SessionState) => {
    session = next;
    for (const listener of listeners) listener();
  };
  const model = createCasesModel({
    session: {
      getSnapshot: () => session,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      refresh: async () => {
        refreshes++;
        setSession({ ...owner(), phase: "anonymous", session: null });
      },
    },
    schedule: (callback) => {
      poll = callback;
      return () => {
        poll = undefined;
      };
    },
    createClient: () => ({
      list: async () => [structuredClone(item)],
      get: async () => {
        reads++;
        await getDelay;
        return structuredClone(item);
      },
      create: async () => {
        calls++;
        await delay;
        return structuredClone(item);
      },
      getQuestions: async () => {
        if (failQuestions) throw new ApiError("UNAVAILABLE", "합성 읽기 실패", true);
        return structuredClone(questions);
      },
      saveAnswers: async (_id, input) => {
        answersInputSchema.parse(input);
        saved.push(input.answers.map((v) => v.questionId));
        questions.revision++;
        item.revision++;
        return structuredClone(questions);
      },
      advance: async () => {
        advances++;
        questions = { ...questions, processing: true };
        return structuredClone(questions);
      },
      saveSummary: async (_id, input) => {
        item = {
          ...item,
          revision: item.revision + 1,
          summary: input.summary,
          stage: "summary",
          summaryDetails: { ...summary, overview: input.summary, unknowns: input.unknowns ?? [] },
        };
        return structuredClone(item);
      },
      confirmSummary: async () => {
        confirmations++;
        item = { ...item, stage: "active", revision: item.revision + 1 };
        return structuredClone(item);
      },
    }),
  });
  const stop = model.start();
  return {
    model,
    stop,
    session: setSession,
    fail: (value: boolean) => {
      failQuestions = value;
    },
    delay: (value: Promise<void>) => {
      delay = value;
    },
    holdGet: (value: Promise<void>) => {
      getDelay = value;
    },
    counts: () => ({ calls, reads, refreshes, confirmations, advances }),
    saved,
    poll: () => poll,
    summary() {
      item = {
        ...item,
        stage: "summary",
        revision: item.revision + 1,
        summary: summary.overview,
        summaryDetails: summary,
      };
      questions = { ...questions, complete: true, processing: false, revision: item.revision };
    },
    revision() {
      item.revision++;
      questions.revision++;
    },
  };
}
test("workspace review navigation resolves an opaque case ID through fresh API reads without creating or advancing a case", async () => {
  const f = fixture();
  await settled();
  f.summary();
  await f.model.open(base.id);
  expect(f.model.getSnapshot()).toMatchObject({
    view: "detail",
    item: { id: base.id, stage: "summary" },
    summary: summary.overview,
  });
  expect(f.counts()).toMatchObject({ calls: 0, advances: 0, confirmations: 0 });
  f.stop();
});
test("leaving the route discards unwatched private input before logout and same-owner login", async () => {
  const f = fixture();
  await settled();
  f.model.newCase();
  f.model.setNarrative(narrative);
  f.stop();
  f.session({ ...owner(), phase: "anonymous", session: null });
  f.session(owner());
  const stop = f.model.start();
  await settled();
  expect(f.model.getSnapshot().narrative).toBe("");
  stop();
});
test("a committed creation stays in detail if the following questions read fails, so retry cannot create another case", async () => {
  const f = fixture();
  await settled();
  f.model.newCase();
  f.model.setNarrative(narrative);
  f.fail(true);
  await f.model.create();
  expect(f.counts().calls).toBe(1);
  expect(f.model.getSnapshot().view).toBe("detail");
  expect(f.model.getSnapshot().item?.id).toBe(base.id);
  expect(f.model.getSnapshot().narrative).toBe("");
  f.fail(false);
  await f.model.refresh();
  expect(f.model.getSnapshot().questions?.questions.length).toBe(6);
  expect(f.counts().calls).toBe(1);
  f.stop();
});
test("each round saves at most three answers including unknown/skipped, preserving unsaved edits in other rounds", async () => {
  const f = fixture();
  await settled();
  await f.model.open(base);
  for (let n = 1; n <= 6; n++)
    f.model.answer({ questionId: `q${n}`, state: n % 2 ? "unknown" : "skipped" });
  f.model.selectRound(1);
  await f.model.saveAnswers();
  expect(f.saved[0]).toEqual(["q1", "q2", "q3"]);
  expect(Object.keys(f.model.getSnapshot().answers)).toEqual(["q4", "q5", "q6"]);
  f.model.selectRound(2);
  await f.model.saveAnswers();
  expect(f.saved[1]).toEqual(["q4", "q5", "q6"]);
  expect(f.model.getSnapshot().answers).toEqual({});
  expect(f.model.getSnapshot().conflict).toBe(false);
  f.stop();
});
test("background checking hides private state; drafts restore only for the same fresh owner and late responses cannot cross accounts", async () => {
  const f = fixture();
  await settled();
  f.model.newCase();
  f.model.setNarrative(narrative);
  f.session({ ...owner(), phase: "checking", session: null });
  expect(JSON.stringify(f.model.getSnapshot())).not.toContain(narrative);
  f.session(owner());
  await settled();
  expect(f.model.getSnapshot().narrative).toBe(narrative);
  let release!: () => void;
  f.delay(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const old = f.model.create();
  f.session({ ...owner(), phase: "checking", session: null });
  f.session(owner("b"));
  release();
  await old;
  await settled();
  expect(f.model.getSnapshot().narrative).toBe("");
  expect(f.model.getSnapshot().view).toBe("list");
  f.stop();
});
test("peer revision changes keep drafts visible but require explicit discard before mutation", async () => {
  const f = fixture();
  await settled();
  await f.model.open(base);
  f.model.answer({ questionId: "q1", state: "answered", value: "합성" });
  f.revision();
  await f.model.refresh();
  expect(f.model.getSnapshot().conflict).toBe(true);
  await f.model.saveAnswers();
  expect(f.saved).toHaveLength(0);
  await f.model.refresh(true);
  expect(f.model.getSnapshot().answers).toEqual({});
  expect(f.model.getSnapshot().conflict).toBe(false);
  f.stop();
});
test("processing polls only while active; summary edits must be acknowledged before confirmation", async () => {
  const f = fixture();
  await settled();
  await f.model.open(base);
  await f.model.advance();
  expect(f.poll()).toBeFunction();
  f.session({ ...owner(), phase: "checking", session: null });
  expect(f.poll()).toBeUndefined();
  f.summary();
  f.session(owner());
  await settled();
  expect(f.model.getSnapshot().item?.stage).toBe("summary");
  f.model.editSummary("수정한 합성 요약");
  await f.model.confirm();
  expect(f.counts().confirmations).toBe(0);
  await f.model.saveSummary();
  await f.model.confirm();
  expect(f.model.getSnapshot().item?.stage).toBe("active");
  expect(f.counts().confirmations).toBe(1);
  f.stop();
});

test("cancellation preserves the input and ignores an eventual creation response", async () => {
  const f = fixture();
  await settled();
  f.model.newCase();
  f.model.setNarrative(narrative);
  let release!: () => void;
  f.delay(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const old = f.model.create();
  f.model.cancel();
  release();
  await old;
  expect(f.model.getSnapshot().view).toBe("create");
  expect(f.model.getSnapshot().narrative).toBe(narrative);
  expect(f.model.getSnapshot().busy).toBe(false);
  f.stop();
});

test("acknowledged answer saving remains busy until its fresh case read completes", async () => {
  const f = fixture();
  await settled();
  await f.model.open(base);
  let release!: () => void;
  f.holdGet(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  f.model.selectRound(1);
  f.model.answer({ questionId: "q1", state: "unknown" });
  const saving = f.model.saveAnswers();
  await settled();
  expect(f.model.getSnapshot().busy).toBe(true);
  const reads = f.counts().reads;
  await f.model.refresh();
  expect(f.counts().reads).toBe(reads);
  release();
  await saving;
  expect(f.model.getSnapshot().busy).toBe(false);
  f.stop();
});
