import { afterEach, expect, test } from "bun:test";
import { casesApi } from "../src/client/api/cases";
import type { V2QuestionBatch } from "../src/contracts/v2";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const NOW = "2026-10-07T00:00:00.000Z";
const ID = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const batch = (ordinal: number, revision: number, answered = false): V2QuestionBatch => ({
  id: `batch-${ordinal}`,
  ordinal,
  generatedForIntakeRevision: revision,
  questions: [
    {
      id: `question-${ordinal}`,
      prompt: `확인할 내용 ${ordinal}은 무엇인가요?`,
      answerType: "text",
      options: [],
    },
  ],
  answers: answered ? [{ questionId: `question-${ordinal}`, status: "unknown" }] : [],
});

function fixture(kind: "first" | "second" | "summary" = "first") {
  const previous =
    kind === "first"
      ? []
      : kind === "second"
        ? [batch(1, 1, true)]
        : [batch(1, 1, true), batch(2, 2, true)];
  const intakeRevision = kind === "first" ? 1 : kind === "second" ? 2 : 3;
  const before = {
    schemaVersion: "2",
    revision: intakeRevision,
    status: "generating_questions",
    narrative: "실제 사건이 아닌 질문 완료 시점의 경합을 확인하는 합성 입력입니다.",
    batches: previous,
    confirmedSummaryRevision: null,
    currentJobId: JOB,
    summary: null,
  };
  const after = {
    ...before,
    status: kind === "summary" ? "reviewing_summary" : "collecting",
    currentJobId: null,
    batches:
      kind === "summary" ? previous : [...previous, batch(previous.length + 1, intakeRevision)],
    summary: kind === "summary" ? { id: "summary-one", revision: 1 } : null,
  };
  const workspace = (completed: boolean) => ({
    schemaVersion: "2",
    id: ID,
    title: "사건 작업 공간",
    subjectContext: "individual",
    jurisdiction: "KR",
    status: "intake",
    archivedFrom: null,
    workspaceRevision: completed ? 11 : 10,
    intakeRevision,
    confirmedSummaryRevision: null,
    currentJobId: completed ? null : JOB,
    legacySnapshotId: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const job = {
    schemaVersion: "2",
    id: JOB,
    operationId: "operation-one",
    target: { kind: "workspace", caseId: ID, workspaceRevision: 10 },
    kind: kind === "summary" ? "intake_summary" : "intake_questions",
    status: "completed",
    phase: "finished",
    progressPercent: 100,
    attempts: 1,
    failure: null,
    retryable: false,
    updatedAt: NOW,
  };
  return { before, after, workspace, job };
}

for (const kind of ["first", "second", "summary"] as const)
  test(`${kind} completion between metadata and job reads returns the published result without a refresh`, async () => {
    const f = fixture(kind);
    let completed = false;
    const reads: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      reads.push(url);
      if (url.endsWith("/workspace")) return Response.json(f.workspace(completed));
      if (url.endsWith("/intake")) return Response.json(completed ? f.after : f.before);
      completed = true;
      return Response.json(f.job);
    }) as typeof fetch;
    const value = await casesApi.getQuestions(ID);
    expect(value.processing).toBe(false);
    expect(value.revision).toBe(11);
    expect(value.questions.map((q) => q.id)).toEqual(
      f.after.batches.flatMap((b) => b.questions.map((q) => q.id)),
    );
    expect(value.complete).toBe(kind === "summary");
    expect(reads.filter((url) => url.endsWith("/intake"))).toHaveLength(2);
    expect(reads).toHaveLength(6);
  });

test("a null metadata CAS result is reread once for both case view and questions", async () => {
  const f = fixture();
  for (const read of [() => casesApi.get(ID), () => casesApi.getQuestions(ID)]) {
    let metadataReads = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/workspace")) return Response.json(f.workspace(true));
      if (url.endsWith("/intake")) return Response.json(++metadataReads === 1 ? null : f.after);
      return Response.json(f.job);
    }) as typeof fetch;
    await read();
    expect(metadataReads).toBe(2);
  }
});

test("a completed job with no published metadata fails after two reads rather than returning an empty idle view", async () => {
  const f = fixture();
  let metadataReads = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/workspace")) return Response.json(f.workspace(false));
    if (url.endsWith("/intake")) {
      metadataReads++;
      return Response.json(f.before);
    }
    return Response.json(f.job);
  }) as typeof fetch;
  await expect(casesApi.getQuestions(ID)).rejects.toMatchObject({
    code: "UNAVAILABLE",
    retryable: true,
  });
  expect(metadataReads).toBe(2);
});

test("persistent null case metadata is bounded and does not become a missing-case fallback", async () => {
  const f = fixture();
  const reads: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    reads.push(url);
    return Response.json(url.endsWith("/workspace") ? f.workspace(true) : null);
  }) as typeof fetch;
  await expect(casesApi.get(ID)).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(reads.filter((url) => url.endsWith("/intake"))).toHaveLength(2);
  expect(reads).toHaveLength(3);
});

test("latest completion exposes stale pointer-free second-round metadata", async () => {
  const f = fixture("second");
  let metadataReads = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/workspace")) return Response.json(f.workspace(true));
    if (url.endsWith("/intake"))
      return Response.json(
        ++metadataReads === 1 ? { ...f.before, currentJobId: null, status: "collecting" } : f.after,
      );
    return Response.json(f.job);
  }) as typeof fetch;
  expect((await casesApi.getQuestions(ID)).rounds).toHaveLength(2);
  expect(metadataReads).toBe(2);
});

test("a terminal failure is reconciled to its new revision before exposing retry", async () => {
  const f = fixture();
  let failed = false;
  const job = {
    ...f.job,
    status: "failed",
    failure: "POLICY_REJECTED",
    retryable: true,
    phase: "validating",
    progressPercent: 50,
  };
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/workspace")) return Response.json(f.workspace(failed));
    if (url.endsWith("/intake"))
      return Response.json(
        failed ? { ...f.before, currentJobId: null, status: "collecting" } : f.before,
      );
    failed = true;
    return Response.json(job);
  }) as typeof fetch;
  expect(await casesApi.getQuestions(ID)).toMatchObject({
    revision: 11,
    processing: false,
    failed: true,
    failure: "POLICY_REJECTED",
    retryable: true,
  });
});

test("workspace and intake from opposite sides of publication are reread together", async () => {
  const f = fixture();
  let reads = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/workspace")) return Response.json(f.workspace(true));
    if (url.endsWith("/intake")) return Response.json(++reads === 1 ? f.before : f.after);
    return Response.json(f.job);
  }) as typeof fetch;
  expect((await casesApi.getQuestions(ID)).questions).toHaveLength(1);
  expect(reads).toBe(2);
});

test("an active chat job does not invalidate confirmed intake metadata", async () => {
  const f = fixture("summary");
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/workspace"))
      return Response.json({
        ...f.workspace(true),
        status: "active",
        confirmedSummaryRevision: 1,
        currentJobId: JOB,
      });
    if (url.endsWith("/intake"))
      return Response.json({ ...f.after, status: "confirmed", confirmedSummaryRevision: 1 });
    return Response.json({
      ...f.job,
      kind: "chat_response",
      status: "running",
      phase: "generating",
      progressPercent: 50,
    });
  }) as typeof fetch;
  expect(await casesApi.getQuestions(ID)).toMatchObject({ complete: true, processing: false });
});
