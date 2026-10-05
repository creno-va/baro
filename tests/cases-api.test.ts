import { afterEach, expect, test } from "bun:test";
import {
  analysisStatusResponseSchema,
  caseDetailResponseSchema,
  caseListResponseSchema,
} from "../src/contracts";
import { api } from "../src/server/api";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { outOfScope, questions } from "./fixtures/contracts";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: false });
  const other = await seedTestSession(db, { consent: true });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, "") };
  const cipher = await createCaseDataCipher(env);
  return { db, owner, other, env, repo: createDomainRepository(db.binding, cipher) };
}
async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const p = {
    ownerId: f.owner.userId,
    caseId: crypto.randomUUID(),
    analysisId: crypto.randomUUID(),
    outboxId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    input: "synthetic private sentinel",
    now: new Date().toISOString(),
  };
  await f.repo.commitInitialCase(p);
  return p;
}
function request(
  f: Awaited<ReturnType<typeof fixture>>,
  path: string,
  method = "GET",
  key?: string,
  other = false,
  body?: string,
) {
  return api.request(
    `/cases${path}`,
    {
      method,
      headers: {
        cookie: other ? f.other.cookie : f.owner.cookie,
        origin: f.env.BETTER_AUTH_URL,
        "x-request-id": "safe-test-id",
        ...(key ? { "idempotency-key": key } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    },
    f.env,
  );
}
test("owner cursor pagination, malformed query, current detail and request ID", async () => {
  const f = await fixture();
  const rows = await Promise.all([create(f), create(f), create(f)]);
  const list = await request(f, "?limit=2");
  expect(list.status).toBe(200);
  expect(list.headers.get("x-request-id")).toBe("safe-test-id");
  const page = caseListResponseSchema.parse(await list.json());
  expect(page.items).toHaveLength(2);
  const next = caseListResponseSchema.parse(
    await (await request(f, `?limit=2&cursor=${page.nextCursor}`)).json(),
  );
  expect(next.items).toHaveLength(1);
  expect(new Set([...page.items, ...next.items].map((i: { id: string }) => i.id)).size).toBe(3);
  expect((await request(f, "?cursor=invalid")).status).toBe(400);
  expect((await request(f, "?userId=attacker")).status).toBe(400);
  const first = rows[0];
  if (!first) throw new Error("fixture");
  const detail = caseDetailResponseSchema.parse(
    await (await request(f, `/${first.caseId}`)).json(),
  );
  expect(detail.analysisId).toBe(first.analysisId);
  expect(JSON.stringify(detail)).not.toContain("sentinel");
  const a = analysisStatusResponseSchema.parse(
    await (await request(f, `/${first.caseId}/analysis`)).json(),
  );
  expect(a.inputRevision).toBe(1);
  expect(a.status).toBe("queued");
  expect((await request(f, `/${first.caseId}`, "GET", undefined, true)).status).toBe(404);
  expect((await request(f, `/${crypto.randomUUID()}`, "GET", undefined, true)).status).toBe(404);
});
test("owner-only decryption of policy result and questions, stale analysis withheld", async () => {
  const f = await fixture();
  const p = await create(f);
  const g = {
    ownerId: p.ownerId,
    caseId: p.caseId,
    analysisId: p.analysisId,
    inputRevision: 1,
    attempt: 1,
    expectedStatus: "queued" as const,
  };
  await f.repo.compareAndSetAnalysis(g, { status: "screening" }, p.now);
  await f.repo.compareAndSetAnalysis(
    { ...g, expectedStatus: "screening" },
    { status: "completed", result: outOfScope },
    p.now,
  );
  const detail = caseDetailResponseSchema.parse(await (await request(f, `/${p.caseId}`)).json());
  expect(detail.result).toEqual(outOfScope);
  expect(detail.status).toBe("out_of_scope");
  const q = await create(f);
  const qg = { ...g, caseId: q.caseId, analysisId: q.analysisId };
  await f.repo.compareAndSetAnalysis(qg, { status: "screening" }, q.now);
  await f.repo.saveCheckpoint(
    { ...qg, expectedStatus: "screening" },
    JSON.stringify({ questions }),
    q.now,
  );
  await f.repo.compareAndSetAnalysis(
    { ...qg, expectedStatus: "screening" },
    {
      status: "waiting_for_answers",
      questionsAsked: questions.length,
      clarificationExpiresAt: new Date(Date.parse(q.now) + 86_400_000).toISOString(),
    },
    q.now,
  );
  expect(
    caseDetailResponseSchema.parse(await (await request(f, `/${q.caseId}`)).json()).questions,
  ).toEqual(questions);
  f.db.sqlite.query("UPDATE cases SET input_revision=2 WHERE id=?").run(q.caseId);
  expect((await request(f, `/${q.caseId}`)).status).toBe(404);
});
test("deletion journal/cascade/idempotency are atomic under duplicate and storage failure", async () => {
  const f = await fixture();
  const p = await create(f);
  const key = crypto.randomUUID();
  expect((await request(f, `/${p.caseId}`, "DELETE", key, true)).status).toBe(404);
  const deleted = await Promise.all([
    request(f, `/${p.caseId}`, "DELETE", key),
    request(f, `/${p.caseId}`, "DELETE", key),
  ]);
  expect(deleted.map((r) => r.status)).toEqual([204, 204]);
  expect((await request(f, `/${p.caseId}`, "DELETE", crypto.randomUUID())).status).toBe(404);
  expect((await request(f, `/${p.caseId}`)).status).toBe(404);
  for (const table of ["cases", "analyses", "dispatch_outbox"])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  const job = f.db.sqlite
    .query("SELECT workflow_instance_ids,cleanup_state FROM deletion_jobs")
    .get() as { workflow_instance_ids: string; cleanup_state: string };
  expect(job.cleanup_state).toBe("pending");
  expect(JSON.parse(job.workflow_instance_ids)).toEqual([`${p.analysisId}-1`]);
  const q = await create(f);
  f.db.sqlite.exec(
    "CREATE TRIGGER injected BEFORE INSERT ON idempotency_records WHEN NEW.method='DELETE' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const failed = await request(f, `/${q.caseId}`, "DELETE", crypto.randomUUID());
  expect(failed.status).toBe(500);
  expect(JSON.stringify(await failed.json())).not.toMatch(/SQL|stack|synthetic|sentinel/);
  expect(await f.repo.findCase(f.owner.userId, q.caseId)).not.toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 1 });
});
