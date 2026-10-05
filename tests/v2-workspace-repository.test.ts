import { afterEach, expect, test } from "bun:test";
import type { V2Fact, V2QuestionBatch, V2Summary } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core, fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { createV2SummaryStagingRepository } from "../src/server/db/v2-summary-staging";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const H = "a".repeat(64);
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
const admission = () => ({
  operationId: crypto.randomUUID(),
  key: crypto.randomUUID(),
  requestHash: H,
});
async function fixture() {
  const db = await createTestDatabase();
  dbs.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  let beforeDecrypt: { fn: () => void; table?: string } | null = null;
  const actual = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
  });
  const cipher = {
    ...actual,
    decrypt: async (...args: Parameters<typeof actual.decrypt>) => {
      const hook = beforeDecrypt;
      if (hook && (!hook.table || hook.table === args[1].table)) {
        beforeDecrypt = null;
        hook.fn();
      }
      return actual.decrypt(...args);
    },
  };
  const core = createV2Core(db.binding, cipher);
  const actor = { ownerId: owner.userId, now: NOW };
  const ws = createV2WorkspaceRepository(db.binding, cipher);
  const id = crypto.randomUUID();
  expect(
    (
      await ws.create(
        actor,
        id,
        {
          narrative: "합성 사건을 정확하게 문답하고 준비하는 자료입니다.",
          subjectContext: "company",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        admission(),
      )
    ).kind,
  ).toBe("created");
  return {
    db,
    core,
    actor,
    ws,
    id,
    jobs: createV2JobsRepository(core),
    staging: createV2StagingRepository(core),
    summary: createV2SummaryStagingRepository(core),
    hook: (fn: () => void, table?: string) => {
      beforeDecrypt = { fn, ...(table ? { table } : {}) };
    },
  };
}
type F = Awaited<ReturnType<typeof fixture>>;
const g = (f: F) => ({
  ...f.actor,
  workspaceId: f.id,
  expectedRevision: (
    f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.id) as {
      revision: number;
    }
  ).revision,
});
async function job(
  f: F,
  kind: "intake_questions" | "intake_summary" | "chat_response",
  text?: string,
) {
  const id = crypto.randomUUID();
  const a = admission();
  expect(
    await f.jobs.admitWorkspace(
      g(f),
      a,
      id,
      kind,
      text
        ? {
            id: crypto.randomUUID(),
            request: { expectedRevision: g(f).expectedRevision, text, selectedFileIds: [] },
          }
        : undefined,
    ),
  ).toBe(true);
  const acquired = await f.jobs.acquire(
    f.actor,
    id,
    crypto.randomUUID(),
    "2026-10-06T00:04:00.000Z",
  );
  expect(acquired).not.toBeNull();
  if (!acquired) throw new Error("synthetic fixture admission");
  return { ...acquired, operationId: a.operationId };
}
async function batch(f: F, ordinal: number) {
  const execution = await job(f, "intake_questions");
  const intake = await f.ws.readIntake(f.actor, f.id);
  if (!intake) throw new Error("intake");
  const value: V2QuestionBatch = {
    id: crypto.randomUUID(),
    ordinal,
    generatedForIntakeRevision: intake.revision,
    questions: [
      { id: crypto.randomUUID(), prompt: "증거를 보관했나요?", answerType: "text", options: [] },
      {
        id: crypto.randomUUID(),
        prompt: "추가 사실을 알고 있나요?",
        answerType: "choice",
        options: ["예", "아니오"],
      },
    ],
    answers: [],
  };
  expect(await f.ws.writeBatch(g(f), value, execution.lease)).toBe(true);
  return value;
}
const fact = (id: string, intakeRevision: number): V2Fact => ({
  id,
  text: "사용자가 전달한 합성 사실",
  attribution: "user_statement",
  certainty: "reported",
  significance: "neutral",
  references: [{ kind: "intake_narrative", intakeRevision }],
  conflictingFactIds: [],
  userEdited: false,
});
async function summarize(f: F) {
  const execution = await job(f, "intake_summary");
  const intake = await f.ws.readIntake(f.actor, f.id);
  if (!intake) throw new Error("intake");
  const summary: V2Summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: intake.revision,
    createdAt: NOW,
    overview: "합성 사건 요약",
    facts: [fact(crypto.randomUUID(), intake.revision)],
    parties: [{ id: crypto.randomUUID(), label: "사용자", role: "자료 제공자" }],
    unknowns: ["추가 확인 필요"],
    notices: ["법률 판단은 변호사가 검토합니다."],
  };
  expect(await f.ws.writeSummary(g(f), summary, execution.lease)).toBe(true);
  expect(
    await f.ws.confirmSummary(g(f), { expectedRevision: intake.revision, summaryRevision: 1 }),
  ).toBe(true);
  return summary;
}
for (const count of [1, 2])
  test(`adaptive ${count}-batch flow accepts unknown/skipped then summary confirmation/chat/action/timeline`, async () => {
    const f = await fixture();
    for (let i = 1; i <= count; i++) {
      const b = await batch(f, i);
      const intake = await f.ws.readIntake(f.actor, f.id);
      expect(
        await f.jobs.admitWorkspace(g(f), admission(), crypto.randomUUID(), "intake_summary"),
      ).toBe(false);
      expect(
        await f.ws.answer(g(f), b.id, {
          expectedRevision: intake?.revision,
          answers: [
            { questionId: b.questions[0]?.id, status: "unknown" },
            { questionId: b.questions[1]?.id, status: "skipped" },
          ],
        }),
      ).toBe(true);
    }
    const summary = await summarize(f);
    const execution = await job(f, "chat_response", "자료를 정리하고 싶습니다.");
    const response = {
      schemaVersion: "2" as const,
      id: crypto.randomUUID(),
      operationId: execution.operationId,
      workspaceRevision: g(f).expectedRevision,
      createdAt: NOW,
      role: "assistant" as const,
      safety: "validated" as const,
      text: "원본을 안전하게 보관하고 사실을 확인하세요.",
      references: [],
      citations: [],
      warnings: [],
    };
    expect(
      await f.ws.writeMessage(
        g(f),
        { ...response, operationId: crypto.randomUUID() },
        execution.lease,
      ),
    ).toBe(false);
    expect(await f.ws.writeMessage(g(f), response, execution.lease)).toBe(true);
    expect((await f.ws.messages(f.actor, f.id)).length).toBe(2);
    const action = {
      id: crypto.randomUUID(),
      revision: 1,
      kind: "organize_materials" as const,
      title: "자료 정리",
      instructions: "수집한 자료를 정리하세요.",
      caution: "원본은 유지하세요.",
      status: "todo" as const,
      factIds: [summary.facts[0]?.id ?? "missing"],
      references: [],
    };
    expect(await f.ws.writeAction(g(f), { ...action, factIds: ["foreign-fact"] }, null)).toBe(
      false,
    );
    expect(await f.ws.writeAction(g(f), action, null)).toBe(true);
    expect(await f.ws.writeAction(g(f), { ...action, revision: 2, status: "done" }, 1)).toBe(true);
    expect(await f.ws.writeAction(g(f), { ...action, revision: 2, status: "skipped" }, 1)).toBe(
      false,
    );
    expect((await f.ws.actions(f.actor, f.id))[0]?.status).toBe("done");
    const timeline = {
      id: crypto.randomUUID(),
      revision: 1,
      date: null,
      datePrecision: "unknown" as const,
      event: "증거를 확보함",
      certainty: "reported" as const,
      references: [],
      factIds: action.factIds,
      userEdited: false,
    };
    expect(await f.ws.writeTimeline(g(f), timeline, null)).toBe(true);
    expect((await f.ws.timeline(f.actor, f.id))[0]?.event).toBe(timeline.event);
    const usage = f.db.sqlite
      .query("SELECT responses_used,responses_reserved FROM v2_daily_usage WHERE owner_id=?")
      .get(f.actor.ownerId) as { responses_used: number; responses_reserved: number };
    expect(usage).toEqual({ responses_used: count + 2, responses_reserved: 0 });
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
test("answers CAS race has one winner, duplicate cross-batch question and unknown-answer citation are rejected", async () => {
  const f = await fixture();
  const b = await batch(f, 1);
  const current = g(f);
  const request = {
    expectedRevision: 1,
    answers: [
      { questionId: b.questions[0]?.id, status: "unknown" },
      { questionId: b.questions[1]?.id, status: "skipped" },
    ],
  };
  const outcomes = await Promise.all([
    f.ws.answer(current, b.id, request),
    f.ws.answer(current, b.id, request),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  const execution = await job(f, "intake_questions");
  const second = { ...b, id: crypto.randomUUID(), ordinal: 2, generatedForIntakeRevision: 2 };
  expect(await f.ws.writeBatch(g(f), second, execution.lease)).toBe(false);
  expect(await f.jobs.fail(f.actor, execution.lease, "MODEL_SCHEMA_INVALID", false)).toBe(true);
  const sumJob = await job(f, "intake_summary");
  const value: V2Summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 2,
    createdAt: NOW,
    overview: "합성 요약",
    facts: [
      {
        ...fact("f", 2),
        references: [
          { kind: "intake_answer", questionId: b.questions[0]?.id ?? "q", intakeRevision: 2 },
        ],
      },
    ],
    parties: [],
    unknowns: [],
    notices: ["검토 필요"],
  };
  expect(await f.ws.writeSummary(g(f), value, sumJob.lease)).toBe(false);
});
for (const kind of ["messages", "actions", "timeline"] as const)
  test(`${kind} rechecks tombstone after asynchronous decrypt`, async () => {
    const f = await fixture();
    const b = await batch(f, 1);
    expect(
      await f.ws.answer(g(f), b.id, {
        expectedRevision: 1,
        answers: b.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
      }),
    ).toBe(true);
    await summarize(f);
    const execution = await job(f, "chat_response", "합성 질문입니다");
    expect(
      await f.ws.writeMessage(
        g(f),
        {
          schemaVersion: "2",
          id: crypto.randomUUID(),
          operationId: execution.operationId,
          workspaceRevision: g(f).expectedRevision,
          createdAt: NOW,
          role: "assistant",
          safety: "validated",
          text: "합성 답변",
          references: [],
          citations: [],
          warnings: [],
        },
        execution.lease,
      ),
    ).toBe(true);
    if (kind === "actions")
      expect(
        await f.ws.writeAction(
          g(f),
          {
            id: crypto.randomUUID(),
            revision: 1,
            kind: "organize_materials",
            title: "합성 액션",
            instructions: "자료 정리",
            caution: "원본 유지",
            status: "todo",
            factIds: [],
            references: [],
          },
          null,
        ),
      ).toBe(true);
    if (kind === "timeline")
      expect(
        await f.ws.writeTimeline(
          g(f),
          {
            id: crypto.randomUUID(),
            revision: 1,
            date: null,
            datePrecision: "unknown",
            event: "합성 일정",
            certainty: "reported",
            references: [],
            factIds: [],
            userEdited: false,
          },
          null,
        ),
      ).toBe(true);
    f.hook(
      () =>
        f.db.sqlite
          .query(
            "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
          )
          .run(f.id, NOW),
      `v2_${kind}`,
    );
    expect(await f.ws[kind](f.actor, f.id)).toEqual([]);
  });

test("300 facts and 30 parties publish from bounded durable pages and reconstruct every long Unicode fact/reference", async () => {
  const f = await fixture();
  const b = await batch(f, 1);
  expect(
    await f.ws.answer(g(f), b.id, {
      expectedRevision: 1,
      answers: b.questions.map((q) => ({
        questionId: q.id,
        status: "answered",
        value: q.answerType === "choice" ? "예" : "확인된 사용자 진술",
      })),
    }),
  ).toBe(true);
  const execution = await job(f, "intake_summary");
  const summary: V2Summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 2,
    createdAt: NOW,
    overview: "최대 범위 사실관계",
    facts: Array.from({ length: 300 }, (_, i) => ({
      ...fact(`fact-${i}`, 2),
      text: "😀".repeat(2000),
      references: Array.from({ length: 100 }, () => ({
        kind: "intake_answer" as const,
        questionId: b.questions[0]?.id ?? "q",
        intakeRevision: 2,
      })),
    })),
    parties: Array.from({ length: 30 }, (_, i) => ({
      id: `party-${i}`,
      label: "가".repeat(200),
      role: "😀".repeat(300),
    })),
    unknowns: ["추가 확인 사항"],
    notices: ["합성 테스트"],
  };
  const text = JSON.stringify(summary);
  expect(utf8Bytes(text)).toBeGreaterThan(4 * 1024 * 1024);
  const parts = fragmentText(text);
  const id = crypto.randomUUID();
  expect(
    await f.staging.begin(
      g(f),
      {
        id,
        purpose: "summary",
        targetId: f.id,
        revision: 1,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      execution.lease,
    ),
  ).toBe(true);
  for (let i = 0; i < parts.length; i++)
    expect(await f.staging.append(g(f), id, i, parts[i] ?? "", execution.lease)).toBe(true);
  for (let i = 0; i < 300; i++)
    expect(
      await f.summary.stagePage(
        g(f),
        id,
        {
          facts: summary.facts.slice(i, i + 1),
          parties: i < 30 ? summary.parties.slice(i, i + 1) : [],
        },
        execution.lease,
      ),
    ).toBe(true);
  expect(
    await f.staging.seal(
      g(f),
      id,
      { schemaVersion: "2", purpose: "summary", targetId: f.id, revision: 1 },
      execution.lease,
    ),
  ).toBe(true);
  expect(
    await f.summary.publish(
      g(f),
      id,
      {
        summaryId: crypto.randomUUID(),
        summaryRevision: 1,
        intakeRevision: 2,
        factCount: 300,
        partyCount: 30,
      },
      execution.lease,
    ),
  ).toBe(true);
  await expect(f.ws.readIntake(f.actor, f.id)).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
  let seen = 0;
  let cursor: string | undefined;
  while (true) {
    const page = await f.summary.factsPage(f.actor, f.id, 1, cursor, 4);
    for (const value of page.facts) {
      expect(value.text).toBe("😀".repeat(2000));
      expect(value.references).toHaveLength(100);
      seen++;
    }
    if (!page.nextId) break;
    cursor = page.nextId;
  }
  expect(seen).toBe(300);
  let partySeen = 0;
  cursor = undefined;
  while (true) {
    const page = await f.summary.partiesPage(f.actor, f.id, 1, cursor, 4);
    partySeen += page.parties.length;
    if (!page.nextId) break;
    cursor = page.nextId;
  }
  expect(partySeen).toBe(30);
  let rebuilt = "";
  for await (const part of f.staging.fragments(f.actor, id)) rebuilt += part.text;
  expect(JSON.parse(rebuilt)).toEqual(summary);
  expect(await f.ws.confirmSummary(g(f), { expectedRevision: 2, summaryRevision: 1 })).toBe(true);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
}, 30000);
