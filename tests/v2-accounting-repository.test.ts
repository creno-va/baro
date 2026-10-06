import { afterEach, expect, test } from "bun:test";
import type { V2CostAttempt, V2CostQuote, V2OperationQuota } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { usageDateKst } from "../src/server/db/repository";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
  operationStatements,
  quotaPredicate,
  quotaStatements,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository, jobInsertStatements } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-05T14:59:59.999Z";
const MIDNIGHT = "2026-10-05T15:00:00.000Z";
const HASH = "a".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture(now = NOW) {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { now: Date.parse(now), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("s".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  const actor: Actor = { ownerId: owner.userId, now };
  const accounting = createV2AccountingRepository(core, "preview");
  await accounting.ensurePrincipal(actor);
  return {
    database,
    actor,
    core,
    accounting,
    workspace: createV2WorkspaceRepository(database.binding, cipher),
    jobs: createV2JobsRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function admission(key = crypto.randomUUID()) {
  return { operationId: crypto.randomUUID(), key, requestHash: HASH };
}
const request = {
  narrative: "합성 자료만 사용하는 저장소 원자성 검증 사건입니다.",
  subjectContext: "individual" as const,
  jurisdiction: "KR" as const,
  turnstileToken: "synthetic-turnstile",
};
async function createCase(f: Fixture, actor = f.actor, input = admission()) {
  const id = crypto.randomUUID();
  const result = await f.workspace.create(actor, id, request, input);
  expect(result.kind).toBe("created");
  return { id, operationId: input.operationId, input };
}
// Synthetic active targets allow independent AI admissions without consuming case creation allowance.
async function activeWorkspace(f: Fixture) {
  const id = crypto.randomUUID();
  const envelope = await f.core.encrypt("v2_workspaces", id, f.actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  f.database.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(id, f.actor.ownerId, envelope, f.actor.now, f.actor.now);
  return id;
}
function allocation(overrides: Partial<BudgetAllocation> = {}): BudgetAllocation {
  return {
    month: "2026-10",
    version: 1,
    previewKrw: 100,
    productionKrw: 200,
    sharedFixedKrw: 20,
    maintenanceReserveKrw: 30,
    pricingProvenance: "synthetic verified test pricing",
    fxProvenance: "synthetic test FX",
    fundingProvenance: "synthetic test funding",
    reviewedAt: "2026-10-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    fundingState: "funded",
    fundingValidUntil: "2026-12-01T00:00:00Z",
    manifestHash: HASH,
    ...overrides,
  };
}
async function acknowledgments(f: Fixture, manifest: BudgetAllocation) {
  for (const environment of ["preview", "production"] as const) {
    expect(
      await f.accounting.recordAllocationAcknowledgment({
        month: manifest.month,
        version: manifest.version,
        environment,
        manifestHash: manifest.manifestHash,
        drainReceiptId: crypto.randomUUID(),
        now: f.actor.now,
      }),
    ).toBe(true);
  }
}
async function fund(f: Fixture, manifest = allocation()) {
  expect(await f.accounting.recordAllocation(manifest)).toBe(true);
  await acknowledgments(f, manifest);
  expect(await f.accounting.activateAllocation(manifest.month, manifest.version, f.actor.now)).toBe(
    true,
  );
}
async function quote(f: Fixture, estimatedKrw = 60, overrides: Partial<V2CostQuote> = {}) {
  const value: V2CostQuote = {
    id: crypto.randomUUID(),
    version: 1,
    reviewedAt: "2026-10-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    currency: "KRW",
    providerPricingVersion: "synthetic-test-price",
    exchangeRateKrwPerUsd: 1375.25,
    safetyMarginRatio: 0.125,
    estimatedKrw,
    ...overrides,
  };
  await f.accounting.putQuote(value);
  return value;
}
function attempt(
  operationId: string,
  q: V2CostQuote,
  now = NOW,
  overrides: Partial<V2CostAttempt> = {},
): V2CostAttempt {
  return {
    id: crypto.randomUUID(),
    operationId,
    invocationId: crypto.randomUUID(),
    attempt: 1,
    quoteId: q.id,
    service: "model",
    state: "reserved",
    reservedKrw: q.estimatedKrw,
    chargedKrw: null,
    createdAt: now,
    ...overrides,
  };
}
function count(f: Fixture, table: string) {
  return (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}
// Tests the exported SQL quota primitives, not a downstream media processing integration.
async function reservePrimitive(
  f: Fixture,
  quota: V2OperationQuota,
  operationId = crypto.randomUUID(),
) {
  const claimId = crypto.randomUUID();
  const predicate = quotaPredicate(quota, f.actor.ownerId, usageDateKst(f.actor.now));
  return f.core.changed([
    f.core.statement(
      `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,1 WHERE ${predicate.sql}`,
      [claimId, f.actor.ownerId, operationId, ...predicate.values],
    ),
    ...operationStatements(
      f.core,
      f.actor,
      {
        id: operationId,
        workspaceId: null,
        kind: "file_extract",
        revision: 1,
        route: "/test/media-primitive",
        key: operationId,
        requestHash: HASH,
      },
      claimId,
    ),
    ...quotaStatements(f.core, f.actor, operationId, quota, claimId),
    f.core.finish(claimId),
  ]);
}

test("new case 3/N concurrency atomically consumes, encrypts and isolates KST days", async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.workspace.create(f.actor, crypto.randomUUID(), request, admission()),
    ),
  );
  expect(results.filter((r) => r.kind === "created")).toHaveLength(3);
  expect(results.filter((r) => r.kind === "rejected")).toHaveLength(3);
  expect(count(f, "v2_workspaces")).toBe(3);
  expect(count(f, "v2_operations")).toBe(3);
  expect(count(f, "v2_mutation_claims")).toBe(0);
  expect((await f.accounting.usage(f.actor)).newCases).toEqual({
    limit: 3,
    used: 3,
    reserved: 0,
    remaining: 0,
  });
  const row = f.database.sqlite.query("SELECT encrypted_payload FROM v2_intakes LIMIT 1").get() as {
    encrypted_payload: string;
  };
  expect(row.encrypted_payload).not.toContain(request.narrative);
  const next = { ...f.actor, now: MIDNIGHT };
  expect((await f.accounting.usage(next)).day).toBe("2026-10-06");
  expect((await f.accounting.usage(next)).resetAt).toBe("2026-10-06T15:00:00.000Z");
  await createCase(f, next);
  expect((await f.accounting.usage(next)).newCases.used).toBe(1);
  expect((await f.accounting.usage(f.actor)).newCases.used).toBe(3);
});

test("same case key replay/conflict/24-hour reuse preserve old operation and cross-account separation", async () => {
  const f = await fixture();
  const original = await createCase(f);
  const replay = await f.workspace.create(
    f.actor,
    crypto.randomUUID(),
    { ...request, turnstileToken: "changed-synthetic-token" },
    { ...original.input, operationId: crypto.randomUUID() },
  );
  expect(replay.kind).toBe("replay");
  expect(
    (
      await f.workspace.create(f.actor, crypto.randomUUID(), request, {
        ...admission(original.input.key),
        requestHash: "b".repeat(64),
      })
    ).kind,
  ).toBe("conflict");
  const other = await seedTestSession(f.database, { consent: true });
  expect(
    await f.accounting.findOperation(
      { ownerId: other.userId, now: NOW },
      "/api/v2/cases",
      original.input.key,
      HASH,
    ),
  ).toBeNull();
  const expired = { ...f.actor, now: "2026-10-06T14:59:59.999Z" };
  await createCase(f, expired, admission(original.input.key));
  expect(count(f, "v2_operations")).toBe(2);
  expect(count(f, "v2_idempotency")).toBe(1);
});

test("cutover legacy over-limit history is preserved and cannot create another allowance", async () => {
  const f = await fixture();
  f.database.sqlite
    .query(
      "INSERT INTO daily_usage(user_id,usage_date_kst,analysis_count,updated_at) VALUES(?,?,10,?)",
    )
    .run(f.actor.ownerId, "2026-10-05", NOW);
  expect((await f.accounting.usage(f.actor)).newCases).toEqual({
    limit: 3,
    used: 10,
    reserved: 0,
    remaining: 0,
  });
  expect((await f.workspace.create(f.actor, crypto.randomUUID(), request, admission())).kind).toBe(
    "rejected",
  );
  expect(count(f, "v2_workspaces")).toBe(0);
});

test("concurrent same-key creation returns one operation without partial counter increments", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.workspace.create(f.actor, crypto.randomUUID(), request, admission(key)),
    ),
  );
  expect(results.filter((result) => result.kind === "created")).toHaveLength(1);
  expect(results.filter((result) => result.kind === "replay")).toHaveLength(4);
  expect(count(f, "v2_operations")).toBe(1);
  expect(count(f, "v2_quota_reservations")).toBe(1);
  expect((await f.accounting.usage(f.actor)).newCases).toEqual({
    limit: 3,
    used: 1,
    reserved: 0,
    remaining: 2,
  });
});

test("visible responses reserve 200 slots concurrently and settle on original day exactly once", async () => {
  const f = await fixture();
  const targets = await Promise.all(Array.from({ length: 201 }, () => activeWorkspace(f)));
  const operations = targets.map(() => admission());
  const results = await Promise.all(
    targets.map((id, i) => {
      const input = operations[i];
      if (!input) throw new Error("Missing synthetic admission");
      return f.jobs.admitWorkspace(
        { ...f.actor, workspaceId: id, expectedRevision: 1 },
        input,
        crypto.randomUUID(),
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: { expectedRevision: 1, text: "합성 질문", selectedFileIds: [] },
        },
      );
    }),
  );
  expect(results.filter(Boolean)).toHaveLength(200);
  expect((await f.accounting.usage(f.actor)).aiResponses).toEqual({
    limit: 200,
    used: 0,
    reserved: 200,
    remaining: 0,
  });
  const winner = operations[results.findIndex(Boolean)];
  if (!winner) throw new Error("Missing successful synthetic admission");
  const next = { ...f.actor, now: MIDNIGHT };
  expect(await f.accounting.settleQuota(next, winner.operationId, "consumed")).toBe(true);
  expect(await f.accounting.settleQuota(next, winner.operationId, "consumed")).toBe(false);
  expect(await f.accounting.settleQuota(next, winner.operationId, "released")).toBe(false);
  expect((await f.accounting.usage(next)).aiResponses.used).toBe(0);
  expect((await f.accounting.usage(f.actor)).aiResponses).toEqual({
    limit: 200,
    used: 1,
    reserved: 199,
    remaining: 0,
  });
});

test("fractional media primitive reserves exact 0.5 seconds, rejects N+1 and releases only once", async () => {
  const f = await fixture();
  const op = crypto.randomUUID();
  expect(
    await reservePrimitive(f, { kind: "media_processing", originalDurationSeconds: 0.5 }, op),
  ).toBe(true);
  expect(
    await reservePrimitive(f, { kind: "media_processing", originalDurationSeconds: 3599.5 }),
  ).toBe(true);
  expect(
    await reservePrimitive(f, { kind: "media_processing", originalDurationSeconds: 0.5 }),
  ).toBe(false);
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toEqual({
    limit: 3600,
    used: 0,
    reserved: 3600,
    remaining: 0,
  });
  const other = await seedTestSession(f.database);
  expect(await f.accounting.settleQuota({ ownerId: other.userId, now: NOW }, op, "released")).toBe(
    false,
  );
  expect(await f.accounting.settleQuota(f.actor, op, "released")).toBe(true);
  expect(await f.accounting.settleQuota(f.actor, op, "released")).toBe(false);
  expect((await f.accounting.usage(f.actor)).mediaSeconds.reserved).toBe(3599.5);
});

test("SQL failure rolls back case rows, counters, idempotency and claim together", async () => {
  const f = await fixture();
  f.database.sqlite.exec(
    "CREATE TRIGGER reject_synthetic_intake BEFORE INSERT ON v2_intakes BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(
    f.workspace.create(f.actor, crypto.randomUUID(), request, admission()),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  for (const table of [
    "v2_workspaces",
    "v2_operations",
    "v2_idempotency",
    "v2_daily_usage",
    "v2_quota_reservations",
    "v2_mutation_claims",
  ])
    expect(count(f, table)).toBe(0);
});

test("quota settlement races consume once and never refund a consumed media operation", async () => {
  const f = await fixture();
  const op = crypto.randomUUID();
  expect(
    await reservePrimitive(f, { kind: "media_processing", originalDurationSeconds: 0.5 }, op),
  ).toBe(true);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => f.accounting.settleQuota(f.actor, op, "consumed")),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await f.accounting.settleQuota(f.actor, op, "released")).toBe(false);
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toEqual({
    limit: 3600,
    used: 0.5,
    reserved: 0,
    remaining: 3599.5,
  });
});

test("local budget requires both trusted manifest acknowledgments and stores fractional FX/margin", async () => {
  const f = await fixture();
  const a = allocation();
  expect(await f.accounting.recordAllocation(a)).toBe(true);
  expect(await f.accounting.activateAllocation(a.month, a.version, NOW)).toBe(false);
  expect(
    await f.accounting.recordAllocationAcknowledgment({
      month: a.month,
      version: a.version,
      environment: "preview",
      manifestHash: "b".repeat(64),
      drainReceiptId: crypto.randomUUID(),
      now: NOW,
    }),
  ).toBe(false);
  await acknowledgments(f, a);
  expect(await f.accounting.activateAllocation(a.month, a.version, NOW)).toBe(true);
  expect((await f.accounting.budget(NOW)).allocatedLimitKrw).toBe(100);
  const q = await quote(f);
  expect(
    f.database.sqlite
      .query("SELECT exchange_rate,safety_margin,reviewed_at FROM v2_cost_quotes WHERE id=?")
      .get(q.id),
  ).toEqual({
    exchange_rate: 1375.25,
    safety_margin: 0.125,
    reviewed_at: "2026-10-01T00:00:00.000Z",
  });
  await expect(
    f.accounting.recordAllocation(allocation({ version: 2, previewKrw: 1000000 })),
  ).rejects.toThrow("REPOSITORY_INPUT_INVALID");
});

test("parallel cost admission respects local limit and duplicate invocation/ordinal reserves once", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const attempts = [attempt(op.operationId, q), attempt(op.operationId, q)];
  expect(
    (await Promise.all(attempts.map((a) => f.accounting.reserveCost(f.actor, a)))).filter(Boolean),
  ).toHaveLength(1);
  expect((await f.accounting.budget(NOW)).reservedKrw).toBe(60);
  expect(count(f, "v2_cost_attempts")).toBe(1);
  const row = f.database.sqlite.query("SELECT id FROM v2_cost_attempts").get() as { id: string };
  expect(await f.accounting.settleCost(row.id, "released", null)).toBe(true);
  const a = attempt(op.operationId, q);
  expect(
    (
      await Promise.all(
        Array.from({ length: 4 }, () =>
          f.accounting.reserveCost(f.actor, { ...a, id: crypto.randomUUID() }),
        ),
      )
    ).filter(Boolean),
  ).toHaveLength(1);
  expect((await f.accounting.budget(NOW)).reservedKrw).toBe(60);
});

test("cost ambiguous→settled preserves exposure, forbids TTL release and accepts late overspend truthfully", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const a = attempt(op.operationId, q);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  expect(await f.accounting.settleCost(a.id, "ambiguous", null)).toBe(true);
  expect(await f.accounting.settleCost(a.id, "ambiguous", null)).toBe(false);
  expect(await f.accounting.settleCost(a.id, "released", null)).toBe(false);
  expect(await f.accounting.settleCost(a.id, "settled", null)).toBe(false);
  expect(await f.accounting.budget(NOW)).toMatchObject({
    reservedKrw: 0,
    ambiguousKrw: 60,
    settledKrw: 0,
    availableKrw: 40,
  });
  expect(await f.accounting.settleCost(a.id, "settled", 125)).toBe(true);
  expect(await f.accounting.settleCost(a.id, "settled", 125)).toBe(false);
  expect(await f.accounting.budget(NOW)).toMatchObject({
    reservedKrw: 0,
    ambiguousKrw: 0,
    settledKrw: 125,
    availableKrw: 0,
  });
  expect(count(f, "v2_cost_receipts")).toBe(2);
  expect(await f.accounting.reserveCost(f.actor, attempt(op.operationId, q))).toBe(false);
});

test("concurrent settlement receipts have one winner and no double refund", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const a = attempt(op.operationId, q);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => f.accounting.settleCost(a.id, "settled", 25)),
  );
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
  expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(1);
  expect(count(f, "v2_cost_receipts")).toBe(1);
  expect(await f.accounting.budget(NOW)).toMatchObject({
    reservedKrw: 0,
    settledKrw: 25,
    availableKrw: 75,
  });
});

test("quote exact expiry and mixed ISO precision, future quote, stale funding and wrong account fail closed", async () => {
  const now = "2026-10-06T00:00:00.001Z";
  const f = await fixture(now);
  const op = await createCase(f);
  await fund(f);
  for (const validUntil of ["2026-10-06T00:00:00Z", now]) {
    const q = await quote(f, 60, { validUntil });
    expect(await f.accounting.reserveCost(f.actor, attempt(op.operationId, q, now))).toBe(false);
  }
  const future = await quote(f, 60, { reviewedAt: "2026-10-06T00:00:00.002Z" });
  expect(await f.accounting.reserveCost(f.actor, attempt(op.operationId, future, now))).toBe(false);
  const q = await quote(f);
  const other = await seedTestSession(f.database);
  expect(
    await f.accounting.reserveCost({ ownerId: other.userId, now }, attempt(op.operationId, q, now)),
  ).toBe(false);
  f.database.sqlite.query("UPDATE v2_budget_allocations SET funding_valid_until=?").run(now);
  expect(await f.accounting.reserveCost(f.actor, attempt(op.operationId, q, now))).toBe(false);
  expect(count(f, "v2_cost_attempts")).toBe(0);
});

test("workspace deletion rejects new paid calls but account deletion preserves opaque past spend", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const a = attempt(op.operationId, q);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  f.database.sqlite.query("INSERT INTO v2_tombstones VALUES('workspace',?,?)").run(op.id, NOW);
  expect(await f.accounting.reserveCost(f.actor, attempt(op.operationId, q))).toBe(false);
  f.database.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(count(f, "v2_cost_attempts")).toBe(1);
  expect(f.database.sqlite.query("SELECT owner_id FROM v2_billing_principals").get()).toEqual({
    owner_id: null,
  });
  // Account deletion already preserves the outstanding exposure through the real SQL trigger.
  expect(
    f.database.sqlite.query("SELECT state FROM v2_cost_attempts WHERE id=?").get(a.id),
  ).toEqual({ state: "ambiguous" });
  expect(await f.accounting.budget(NOW)).toMatchObject({ reservedKrw: 0, ambiguousKrw: 60 });
  expect(await f.accounting.settleCost(a.id, "ambiguous", null)).toBe(false);
  expect(await f.accounting.settleCost(a.id, "settled", 25)).toBe(true);
  expect((await f.accounting.budget(NOW)).settledKrw).toBe(25);
  expect(count(f, "v2_operations")).toBe(0);
});

test("a real SQL failure in settlement rolls back receipt/state/month aggregate and remains retryable", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const a = attempt(op.operationId, q);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  f.database.sqlite.exec(
    "CREATE TRIGGER reject_synthetic_cost BEFORE UPDATE OF state ON v2_cost_attempts BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(f.accounting.settleCost(a.id, "settled", 25)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(count(f, "v2_cost_receipts")).toBe(0);
  expect((await f.accounting.budget(NOW)).reservedKrw).toBe(60);
  expect(
    f.database.sqlite.query("SELECT state FROM v2_cost_attempts WHERE id=?").get(a.id),
  ).toEqual({ state: "reserved" });
  f.database.sqlite.exec("DROP TRIGGER reject_synthetic_cost");
  expect(await f.accounting.settleCost(a.id, "settled", 25)).toBe(true);
});

test("attempt retry has separate actual cost while allocation decreases retain exposure and reject rollback", async () => {
  const f = await fixture();
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f, 40);
  const a = attempt(op.operationId, q);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  expect(await f.accounting.settleCost(a.id, "settled", 20)).toBe(true);
  const retry = { ...a, id: crypto.randomUUID(), attempt: 2 };
  expect(await f.accounting.reserveCost(f.actor, retry)).toBe(true);
  const decreased = allocation({ version: 2, previewKrw: 50, manifestHash: "b".repeat(64) });
  await f.accounting.recordAllocation(decreased);
  await acknowledgments(f, decreased);
  expect(await f.accounting.activateAllocation(decreased.month, 2, NOW)).toBe(false);
  expect(await f.accounting.budget(NOW)).toMatchObject({
    allocationVersion: 1,
    settledKrw: 20,
    reservedKrw: 40,
  });
  expect(await f.accounting.settleCost(retry.id, "released", null)).toBe(true);
  expect(await f.accounting.activateAllocation(decreased.month, 2, NOW)).toBe(true);
  expect(await f.accounting.activateAllocation(decreased.month, 1, NOW)).toBe(false);
  expect(await f.accounting.budget(NOW)).toMatchObject({
    allocationVersion: 2,
    allocatedLimitKrw: 50,
    settledKrw: 20,
    reservedKrw: 0,
    availableKrw: 30,
  });
});

test("late month settlement uses original ledger, not the new KST month", async () => {
  const f = await fixture("2026-10-31T14:59:59.999Z");
  const op = await createCase(f);
  await fund(f);
  const q = await quote(f);
  const a = attempt(op.operationId, q, f.actor.now);
  expect(await f.accounting.reserveCost(f.actor, a)).toBe(true);
  const november = "2026-10-31T15:00:00.000Z";
  await fund(f, allocation({ month: "2026-11" }));
  expect(await f.accounting.settleCost(a.id, "settled", 25)).toBe(true);
  expect(await f.accounting.budget(november)).toMatchObject({
    month: "2026-11",
    settledKrw: 0,
    reservedKrw: 0,
  });
  expect(await f.accounting.budget(f.actor.now)).toMatchObject({
    month: "2026-10",
    settledKrw: 25,
    reservedKrw: 0,
  });
});

test("actual job failure releases unpublished quota; retry re-reserves the same operation/day under contention", async () => {
  const f = await fixture();
  const id = await activeWorkspace(f);
  const input = admission();
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitWorkspace(
      { ...f.actor, workspaceId: id, expectedRevision: 1 },
      input,
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: { expectedRevision: 1, text: "합성 실패/재시도", selectedFileIds: [] },
      },
    ),
  ).toBe(true);
  const leaseUntil = new Date(Date.parse(NOW) + 20000).toISOString();
  const acquired = await f.jobs.acquire(f.actor, jobId, crypto.randomUUID(), leaseUntil);
  if (!acquired) throw new Error("Synthetic job did not acquire");
  expect((await f.accounting.usage(f.actor)).aiResponses).toMatchObject({ used: 0, reserved: 1 });
  expect(await f.jobs.fail(f.actor, acquired.lease, "MODEL_UNAVAILABLE", true)).toBe(true);
  expect(await f.jobs.fail(f.actor, acquired.lease, "MODEL_UNAVAILABLE", true)).toBe(false);
  expect((await f.accounting.usage(f.actor)).aiResponses).toMatchObject({ used: 0, reserved: 0 });
  expect(
    f.database.sqlite.query("SELECT state FROM v2_operations WHERE id=?").get(input.operationId),
  ).toEqual({ state: "failed" });
  const next = { ...f.actor, now: MIDNIGHT, workspaceId: id, expectedRevision: 3 };
  const other = await seedTestSession(f.database);
  expect(await f.jobs.retry({ ...next, ownerId: other.userId }, jobId)).toBe(false);
  // Filling the original day is a synthetic history fixture; a fresh day cannot bypass it.
  f.database.sqlite
    .query("UPDATE v2_daily_usage SET responses_used=200 WHERE owner_id=? AND day='2026-10-05'")
    .run(f.actor.ownerId);
  expect(await f.jobs.retry(next, jobId)).toBe(false);
  expect((await f.accounting.usage({ ...f.actor, now: MIDNIGHT })).aiResponses).toMatchObject({
    used: 0,
    reserved: 0,
    remaining: 200,
  });
  f.database.sqlite
    .query("UPDATE v2_daily_usage SET responses_used=199 WHERE owner_id=? AND day='2026-10-05'")
    .run(f.actor.ownerId);
  expect(
    (await Promise.all(Array.from({ length: 4 }, () => f.jobs.retry(next, jobId)))).filter(Boolean),
  ).toHaveLength(1);
  expect(
    f.database.sqlite
      .query("SELECT operation_id,day,state FROM v2_quota_reservations WHERE operation_id=?")
      .get(input.operationId),
  ).toEqual({ operation_id: input.operationId, day: "2026-10-05", state: "reserved" });
  expect((await f.accounting.usage(f.actor)).aiResponses).toMatchObject({
    used: 199,
    reserved: 1,
    remaining: 0,
  });
  expect(count(f, "v2_operations")).toBe(1);
  expect(
    await f.jobs.fail({ ...f.actor, now: MIDNIGHT }, acquired.lease, "MODEL_UNAVAILABLE", true),
  ).toBe(false);
  const restarted = await f.jobs.acquire(
    { ...f.actor, now: MIDNIGHT },
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(MIDNIGHT) + 20000).toISOString(),
  );
  expect(restarted?.job.operationId).toBe(input.operationId);
  expect(restarted?.job.attempts).toBe(2);
});

test("actual file job first acquire consumes fractional media and fail/retry never charges its duration twice", async () => {
  const f = await fixture();
  const id = await activeWorkspace(f);
  const op = crypto.randomUUID();
  expect(
    await reservePrimitive(f, { kind: "media_processing", originalDurationSeconds: 0.5 }, op),
  ).toBe(true);
  f.database.sqlite.query("UPDATE v2_operations SET workspace_id=? WHERE id=?").run(id, op);
  const fileId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const metadata = await f.core.encrypt("v2_files", fileId, f.actor.ownerId, 1, {
    name: "synthetic.wav",
    declaredMediaType: "audio/wav",
    probe: null,
  });
  f.database.sqlite
    .query(
      "INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,current_job_id,encrypted_payload,created_at,updated_at) VALUES(?,?,?,'queued',100,?,?,?,?)",
    )
    .run(fileId, id, op, jobId, metadata, NOW, NOW);
  const claimId = crypto.randomUUID();
  expect(
    await f.core.changed([
      f.core.claim({ ...f.actor, workspaceId: id, expectedRevision: 1 }, claimId),
      ...jobInsertStatements(
        f.core,
        f.actor,
        {
          schemaVersion: "2",
          id: jobId,
          operationId: op,
          target: { kind: "file", caseId: id, fileId, fileRevision: 1 },
          kind: "file_processing",
          status: "queued",
          phase: "admission",
          progressPercent: 0,
          attempts: 0,
          failure: null,
          retryable: false,
          updatedAt: NOW,
        },
        claimId,
      ),
      f.core.finish(claimId),
    ]),
  ).toBe(true);
  const acquired = await f.jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(NOW) + 20000).toISOString(),
  );
  if (!acquired) throw new Error("Synthetic file job did not acquire");
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toMatchObject({
    used: 0.5,
    reserved: 0,
  });
  expect(await f.jobs.fail(f.actor, acquired.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toMatchObject({
    used: 0.5,
    reserved: 0,
  });
  expect(
    await f.jobs.retry({ ...f.actor, now: MIDNIGHT, workspaceId: id, expectedRevision: 2 }, jobId),
  ).toBe(true);
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toMatchObject({
    used: 0.5,
    reserved: 0,
  });
  const restarted = await f.jobs.acquire(
    { ...f.actor, now: MIDNIGHT },
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(MIDNIGHT) + 20000).toISOString(),
  );
  expect(restarted?.job.attempts).toBe(2);
  expect((await f.accounting.usage(f.actor)).mediaSeconds).toMatchObject({
    used: 0.5,
    reserved: 0,
  });
  expect((await f.accounting.usage({ ...f.actor, now: MIDNIGHT })).mediaSeconds).toMatchObject({
    used: 0,
    reserved: 0,
  });
});
