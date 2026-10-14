import type { SQLQueryBindings } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { initializeEmptyPhysicalStorage } from "../scripts/initialize-storage";
import { inspectAiRuntime } from "../scripts/provision-ai-budget";
import { createTestDatabase } from "./helpers/d1";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
type Row = Record<string, SQLQueryBindings>;
type State = "prepared" | "dispatched" | "unknown" | "final";
const NOW = "2026-10-14T00:00:00.000Z";
const LATER = "2026-10-14T00:01:00.000Z";
const DEADLINE = "2026-10-14T01:00:00.000Z";
const HASH = "a".repeat(64);
const SHA = "a".repeat(40);
const databases: TestDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture(throughMigration?: string) {
  const db = await createTestDatabase(throughMigration ? { throughMigration } : {});
  databases.push(db);
  return db;
}

function insert(db: TestDatabase, table: string, row: Row) {
  const keys = Object.keys(row);
  db.sqlite
    .query(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key] ?? null));
}

// Real migration constraints and transition triggers apply to every synthetic
// fixture. Detached history deliberately does not imply a current blob or job.
function admission(
  db: TestDatabase,
  state: State,
  environment: "preview" | "production" = "preview",
  kind: "storage" | "job" = "storage",
) {
  const principalId = crypto.randomUUID();
  insert(db, "v2_billing_principals", { id: principalId, owner_id: null, created_at: NOW });
  const request = {
    attemptId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    attempt: 1,
    service: kind === "storage" ? "requests" : "model",
    targetKind: kind === "storage" ? "file" : "workspace",
    targetId: crypto.randomUUID(),
    targetRevision: 1,
    plan: {
      operationId: crypto.randomUUID(),
      operationRevision: 1,
      requestHash: HASH,
      invocationId: crypto.randomUUID(),
      maximumAttempts: 1,
      deadlineAt: DEADLINE,
      quantities: [
        {
          sku: kind === "storage" ? "r2_class_a_requests" : "model_input_tokens",
          maximumQuantity: "1",
        },
      ],
    },
    jobId: kind === "job" ? crypto.randomUUID() : null,
    reservationId: kind === "storage" ? crypto.randomUUID() : null,
    blobId: kind === "storage" ? crypto.randomUUID() : null,
    intent: kind === "storage" ? { kind: "case_original" } : null,
  };
  insert(db, "v2_execution_admissions", {
    attempt_id: request.attemptId,
    plan_id: request.planId,
    principal_id: principalId,
    environment,
    kind,
    operation_id: request.plan.operationId,
    operation_revision: 1,
    request_hash: HASH,
    invocation_id: request.plan.invocationId,
    attempt: 1,
    service: request.service,
    job_id: request.jobId,
    runtime_instance_id: kind === "job" ? `synthetic-${request.jobId}` : null,
    target_kind: request.targetKind,
    target_id: request.targetId,
    target_revision: 1,
    reservation_id: request.reservationId,
    blob_id: request.blobId,
    scope: request.intent?.kind ?? null,
    anchor_json: kind === "storage" ? JSON.stringify({ synthetic: true }) : null,
    digest: HASH,
    payload_json: JSON.stringify(request),
    evidence_hash: HASH,
    verified_at: NOW,
    deadline_at: DEADLINE,
    created_at: NOW,
  });
  if (state !== "prepared")
    db.sqlite
      .query(
        "UPDATE v2_execution_admissions SET state='dispatched',dispatch_token=?,dispatched_at=?,lease_token=?,fencing=? WHERE attempt_id=?",
      )
      .run(
        crypto.randomUUID(),
        NOW,
        kind === "job" ? crypto.randomUUID() : null,
        kind === "job" ? 1 : null,
        request.attemptId,
      );
  if (state === "unknown" || state === "final")
    db.sqlite
      .query(
        "UPDATE v2_execution_admissions SET state=?,transport=?,transport_observed_at=?,transport_digest=? WHERE attempt_id=?",
      )
      .run(state, state === "unknown" ? "unknown" : "response", LATER, HASH, request.attemptId);
  return request.attemptId;
}

function observation(
  db: TestDatabase,
  attemptId: string,
  chargedKrw: number | null,
  observedAt = LATER,
) {
  const id = crypto.randomUUID();
  const pricingId = chargedKrw === null ? null : crypto.randomUUID();
  // Synthetic pricing linkage for an already recorded amount: these tests
  // assert status aggregation, never claim to authenticate a provider bill.
  if (pricingId)
    insert(db, "v2_runtime_proofs", {
      id: pricingId,
      kind: "pricing",
      environment: "preview",
      digest: HASH,
      payload_json: JSON.stringify({ synthetic: true }),
      evidence_hash: HASH,
      verification_method: "authenticated_console",
      verified_at: NOW,
      valid_until: DEADLINE,
    });
  const chargedUsd = chargedKrw === null ? null : "0.123456789012345678";
  insert(db, "v2_execution_cost_observations", {
    id,
    attempt_id: attemptId,
    digest: id.replaceAll("-", "").repeat(2),
    payload_json: JSON.stringify({
      id,
      attemptId,
      observedAt,
      transport: "response",
      quantities: [],
      chargedUsd,
    }),
    evidence_hash: HASH,
    verified_at: observedAt,
    observed_at: observedAt,
    pricing_proof_id: pricingId,
    funding_proof_id: null,
    pricing_status: pricingId ? "current" : "missing",
    funding_status: "missing",
    charged_usd: chargedUsd,
    charged_krw: chargedKrw,
  });
}

function bootstrap(db: TestDatabase) {
  return initializeEmptyPhysicalStorage(
    db.binding,
    "preview",
    {
      capacityBytes: 100000000000,
      expectedReleaseSha: SHA,
      inventory: {
        environment: "preview",
        checkedAt: NOW,
        privateBucketObjects: 0,
        publicBucketObjects: 0,
        authority: "authenticated_cloudflare_console",
      },
    },
    "synthetic-journal-guard",
    SHA,
    () => NOW,
  );
}

for (const state of ["prepared", "dispatched", "unknown"] as const)
  test(`empty physical bootstrap refuses actual 0016 ${state} storage history without mutating it`, async () => {
    const db = await fixture();
    admission(db, state);
    expect(db.sqlite.query("SELECT * FROM v2_blobs").all()).toEqual([]);
    expect(db.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
    const before = db.sqlite.serialize();
    await expect(bootstrap(db)).rejects.toThrow("STORAGE_INITIALIZATION_PHYSICAL_CONFLICT");
    expect(db.sqlite.serialize()).toEqual(before);
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

test("bootstrap journal guard is transactional when storage admission arrives after its preliminary reads", async () => {
  const db = await fixture();
  const batch = db.binding.batch.bind(db.binding);
  let before = db.sqlite.serialize();
  db.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    admission(db, "prepared");
    before = db.sqlite.serialize();
    return batch<T>(statements);
  };
  await expect(bootstrap(db)).rejects.toThrow("STORAGE_INITIALIZATION_PHYSICAL_CONFLICT");
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_execution_admissions").get()).toEqual({
    n: 1,
  });
  expect(db.sqlite.serialize()).toEqual(before);
  expect(db.sqlite.query("SELECT * FROM v2_runtime_claims").all()).toEqual([]);
});

test("physical bootstrap preserves final storage history and ignores another environment's live journal", async () => {
  const db = await fixture();
  admission(db, "final");
  admission(db, "unknown", "production");
  const history = db.sqlite.query("SELECT * FROM v2_execution_admissions").all();
  expect((await bootstrap(db)).replayed).toBe(false);
  expect(db.sqlite.query("SELECT * FROM v2_execution_admissions").all()).toEqual(history);
  expect(db.sqlite.query("SELECT * FROM v2_execution_cost_observations").all()).toEqual([]);
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("operational status distinguishes an absent journal from an empty or wholly unpriced journal", async () => {
  const old = await fixture("0015_cost_observation_only");
  expect((await inspectAiRuntime({ preview: old.binding })).results[0]?.executionObservations).toBe(
    null,
  );
  const db = await fixture();
  expect(
    (await inspectAiRuntime({ preview: db.binding })).results[0]?.executionObservations,
  ).toEqual({
    admissions: 0,
    unresolvedTransport: 0,
    unpricedAdmissions: 0,
    knownObservedKrw: null,
  });
  admission(db, "prepared");
  observation(db, admission(db, "unknown"), null);
  const before = db.sqlite.serialize();
  expect(
    (await inspectAiRuntime({ preview: db.binding })).results[0]?.executionObservations,
  ).toEqual({
    admissions: 2,
    unresolvedTransport: 1,
    unpricedAdmissions: 2,
    knownObservedKrw: null,
  });
  expect(
    db.sqlite.query("SELECT charged_usd,charged_krw FROM v2_execution_cost_observations").all(),
  ).toEqual([{ charged_usd: null, charged_krw: null }]);
  expect(db.sqlite.serialize()).toEqual(before);
});

test("operational status reports actual state counts and one latest known amount per admission as exact decimal text", async () => {
  const db = await fixture();
  const first = admission(db, "final", "preview", "job");
  observation(db, first, 11, NOW);
  observation(db, first, 9007199254740990);
  observation(db, first, null, "2026-10-14T00:02:00.000Z");
  observation(db, admission(db, "final"), 101);
  observation(db, admission(db, "unknown"), null);
  admission(db, "dispatched", "preview", "job");
  admission(db, "prepared");
  admission(db, "unknown", "production");
  const before = db.sqlite.serialize();
  const status = await inspectAiRuntime({ preview: db.binding, production: db.binding });
  expect(
    status.results.map(({ environment, executionObservations }) => ({
      environment,
      executionObservations,
    })),
  ).toEqual([
    {
      environment: "preview",
      executionObservations: {
        admissions: 5,
        unresolvedTransport: 2,
        unpricedAdmissions: 3,
        knownObservedKrw: "9007199254741091",
      },
    },
    {
      environment: "production",
      executionObservations: {
        admissions: 1,
        unresolvedTransport: 1,
        unpricedAdmissions: 1,
        knownObservedKrw: null,
      },
    },
  ]);
  expect(
    db.sqlite
      .query(
        "SELECT DISTINCT charged_usd FROM v2_execution_cost_observations WHERE charged_usd IS NOT NULL",
      )
      .all(),
  ).toEqual([{ charged_usd: "0.123456789012345678" }]);
  expect(JSON.stringify(status)).not.toMatch(
    /payload_json|attempt_id|principal_id|synthetic|reference/,
  );
  expect(db.sqlite.serialize()).toEqual(before);
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("an observed zero remains decimal zero while absent amounts remain unknown", async () => {
  const db = await fixture();
  observation(db, admission(db, "final"), 0);
  observation(db, admission(db, "final"), null);
  expect(
    (await inspectAiRuntime({ preview: db.binding })).results[0]?.executionObservations,
  ).toEqual({
    admissions: 2,
    unresolvedTransport: 0,
    unpricedAdmissions: 1,
    knownObservedKrw: "0",
  });
});
