import { afterEach, expect, test } from "bun:test";
import { casesApi } from "../src/client/api/cases";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fixture(retryable: boolean, revision = 6) {
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = "2026-10-07T00:00:00.000Z";
  const workspace = {
    schemaVersion: "2",
    id,
    title: "사건 작업 공간",
    subjectContext: "individual",
    jurisdiction: "KR",
    status: "intake",
    archivedFrom: null,
    workspaceRevision: revision,
    intakeRevision: 3,
    confirmedSummaryRevision: null,
    currentJobId: null,
    legacySnapshotId: null,
    createdAt: now,
    updatedAt: now,
  };
  const metadata = {
    schemaVersion: "2",
    revision: 3,
    status: "collecting",
    narrative: "합성 입력입니다. 질문 저장 이후 생성 실패 복구를 확인합니다.",
    batches: [],
    confirmedSummaryRevision: null,
    currentJobId: null,
    summary: null,
  };
  const job = {
    schemaVersion: "2",
    id: jobId,
    operationId: crypto.randomUUID(),
    target: { kind: "workspace", caseId: id, workspaceRevision: 5 },
    kind: "intake_questions",
    status: "failed",
    phase: "generating",
    progressPercent: 50,
    attempts: retryable ? 1 : 3,
    failure: "POLICY_REJECTED",
    retryable,
    updatedAt: now,
  };
  const writes: { path: string; body: unknown }[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    if (init?.method && init.method !== "GET") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({});
    }
    return Response.json(
      path.endsWith("/workspace") ? workspace : path.endsWith("/intake") ? metadata : job,
    );
  }) as typeof fetch;
  return { id, jobId, writes };
}

test("failed intake projects output-validation failure and retries generation only", async () => {
  const f = fixture(true);
  expect(await casesApi.getQuestions(f.id)).toMatchObject({
    revision: 6,
    failed: true,
    processing: false,
    retryable: true,
    failure: "POLICY_REJECTED",
  });
  await casesApi.advance(f.id, { expectedRevision: 6 });
  expect(f.writes).toEqual([
    {
      path: `/api/v2/cases/${f.id}/workspace-jobs/${f.jobId}/retry`,
      body: { expectedRevision: 6 },
    },
  ]);
});

test("exhausted failure cannot submit another retry", async () => {
  const f = fixture(false);
  expect(await casesApi.getQuestions(f.id)).toMatchObject({ failed: true, retryable: false });
  await expect(casesApi.advance(f.id, { expectedRevision: 6 })).rejects.toMatchObject({
    code: "UNAVAILABLE",
    retryable: false,
  });
  expect(f.writes).toEqual([]);
});

test("edited answers supersede the older exhausted failure and advance with new input", async () => {
  const f = fixture(false, 7);
  expect(await casesApi.getQuestions(f.id)).toMatchObject({ revision: 7, processing: false });
  expect((await casesApi.getQuestions(f.id)).failed).not.toBe(true);
  await casesApi.advance(f.id, { expectedRevision: 7 });
  expect(f.writes).toEqual([
    { path: `/api/v2/cases/${f.id}/intake/advance`, body: { expectedRevision: 7 } },
  ]);
});
