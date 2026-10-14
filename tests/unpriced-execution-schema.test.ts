import type { SQLQueryBindings } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { createTestDatabase } from "./helpers/d1";

const NOW = "2026-10-14T01:00:00.000Z";
const LATER = "2026-10-14T01:00:01.000Z";
const DEADLINE = "2026-10-14T01:05:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
type Database = Awaited<ReturnType<typeof createTestDatabase>>;
type Row = Record<string, SQLQueryBindings | undefined>;
type Json = Record<string, unknown>;
const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function insert(db: Database, table: string, row: Row) {
  const keys = Object.keys(row);
  return db.sqlite
    .query(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key] ?? null));
}

async function fixture(upgrade = false) {
  const db = await createTestDatabase(
    upgrade ? { throughMigration: "0015_cost_observation_only" } : {},
  );
  databases.push(db);
  const principalId = crypto.randomUUID();
  // A durable, detached principal is intentional: old account deletion must
  // not prevent execution history or authenticated late observations surviving.
  insert(db, "v2_billing_principals", { id: principalId, owner_id: null, created_at: NOW });
  return { db, principalId };
}

function admission(principalId: string, kind: "job" | "storage" = "job"): Row {
  const request: Json = {
    attemptId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    quoteId: null,
    pricingProofId: null,
    fundingProofId: null,
    attempt: 1,
    service: kind === "job" ? "model" : "requests",
    targetKind: kind === "job" ? "workspace" : "file",
    targetId: crypto.randomUUID(),
    targetRevision: 2,
    plan: {
      operationId: crypto.randomUUID(),
      operationRevision: 3,
      requestHash: HASH,
      invocationId: crypto.randomUUID(),
      maximumAttempts: 3,
      deadlineAt: DEADLINE,
      quantities:
        kind === "job"
          ? [
              { sku: "model_input_tokens", maximumQuantity: "1000" },
              { sku: "model_output_tokens", maximumQuantity: "500" },
            ]
          : [{ sku: "r2_class_a_requests", maximumQuantity: "1" }],
    },
    ...(kind === "job"
      ? { jobId: crypto.randomUUID() }
      : {
          reservationId: crypto.randomUUID(),
          blobId: crypto.randomUUID(),
          pending: { logicalBytes: 10, cipherBytes: 0, cipherHash: null, keyVersion: null },
          intent: {
            kind: "case_original",
            uploadId: crypto.randomUUID(),
            uploadRevision: 1,
            ordinal: 0,
          },
        }),
  };
  const plan = request.plan as Json;
  return {
    attempt_id: request.attemptId as string,
    plan_id: request.planId as string,
    principal_id: principalId,
    environment: "preview",
    kind,
    operation_id: plan.operationId as string,
    operation_revision: plan.operationRevision as number,
    request_hash: HASH,
    invocation_id: plan.invocationId as string,
    attempt: 1,
    service: request.service as string,
    job_id: (request.jobId as string | undefined) ?? null,
    runtime_instance_id: kind === "job" ? `synthetic-run-${String(request.jobId)}` : null,
    target_kind: request.targetKind as string,
    target_id: request.targetId as string,
    target_revision: request.targetRevision as number,
    reservation_id: (request.reservationId as string | undefined) ?? null,
    blob_id: (request.blobId as string | undefined) ?? null,
    scope: kind === "storage" ? "case_original" : null,
    anchor_json:
      kind === "storage" ? JSON.stringify({ source: "synthetic immutable anchor" }) : null,
    digest: HASH,
    payload_json: JSON.stringify(request),
    evidence_hash: OTHER_HASH,
    verified_at: NOW,
    deadline_at: DEADLINE,
    created_at: NOW,
  };
}

const MISSING = Symbol("missing");
function payloadField(row: Row, path: string, value: unknown) {
  const payload = JSON.parse(String(row.payload_json)) as Json;
  const parts = path.split(".");
  let parent = payload;
  for (const part of parts.slice(0, -1)) parent = parent[part] as Json;
  const key = parts[parts.length - 1];
  if (!key) throw new Error("Synthetic path missing");
  if (value === MISSING) delete parent[key];
  else parent[key] = value;
  row.payload_json = JSON.stringify(payload);
}

function bind(row: Row, column: string, path: string, value: SQLQueryBindings) {
  row[column] = value;
  payloadField(row, path, value);
  return row;
}

function financialFixture(db: Database) {
  const pricing = crypto.randomUUID(),
    funding = crypto.randomUUID(),
    quote = crypto.randomUUID();
  // Opaque historical synthetic evidence is copied byte-for-byte by migration;
  // these rows are never asserted to authenticate a real provider or price.
  for (const [id, kind] of [
    [pricing, "pricing"],
    [funding, "funding"],
  ] as const)
    insert(db, "v2_runtime_proofs", {
      id,
      kind,
      environment: "preview",
      digest: HASH,
      payload_json: JSON.stringify({ id, kind, synthetic: true, checkedAt: NOW }),
      evidence_hash: OTHER_HASH,
      verification_method: "authenticated_console",
      verified_at: NOW,
      valid_until: DEADLINE,
    });
  insert(db, "v2_monthly_budget", {
    month: "2026-10",
    allocation_version: 1,
    environment: "preview",
    limit_krw: 1000,
    reserved_krw: 123,
    ambiguous_krw: 456,
  });
  insert(db, "v2_cost_quotes", {
    id: quote,
    version: 1,
    reviewed_at: NOW,
    valid_until: DEADLINE,
    currency: "KRW",
    provider_pricing_version: pricing,
    exchange_rate: 1234.567,
    safety_margin: 0.123,
    estimated_krw: 123,
  });
  return { pricing, funding, quote };
}

function insertLegacy(
  db: Database,
  row: Row,
  financial: ReturnType<typeof financialFixture>,
  unresolved = false,
) {
  const request = JSON.parse(String(row.payload_json)) as Json;
  request.quoteId = financial.quote;
  request.pricingProofId = financial.pricing;
  request.fundingProofId = financial.funding;
  const payload = JSON.stringify(request);
  db.sqlite.transaction(() => {
    const plan = {
      id: row.plan_id,
      operation_id: row.operation_id,
      operation_revision: row.operation_revision,
      request_hash: row.request_hash,
      invocation_id: row.invocation_id,
      pricing_proof_id: financial.pricing,
      funding_proof_id: financial.funding,
      job_id: row.job_id,
      target_kind: row.target_kind,
      target_id: row.target_id,
      target_revision: row.target_revision,
      digest: row.digest,
      payload_json: payload,
      evidence_hash: row.evidence_hash,
      verified_at: row.verified_at,
      maximum_attempts: 3,
      reserved_krw: 123,
      deadline_at: row.deadline_at,
      created_at: row.created_at,
    };
    if (row.kind === "job") insert(db, "v2_runtime_plans", plan);
    insert(db, "v2_cost_attempts", {
      id: row.attempt_id,
      principal_id: row.principal_id,
      operation_id: row.operation_id,
      invocation_id: row.invocation_id,
      attempt: row.attempt,
      month: "2026-10",
      quote_id: financial.quote,
      service: row.service,
      state: unresolved ? "ambiguous" : "reserved",
      reserved_krw: unresolved ? 456 : 123,
      charged_krw: null,
      created_at: NOW,
    });
    const dispatch = unresolved
      ? { state: "unknown", dispatch_token: crypto.randomUUID(), dispatched_at: LATER }
      : {};
    if (row.kind === "job")
      insert(db, "v2_paid_holds", {
        attempt_id: row.attempt_id,
        plan_id: row.plan_id,
        job_id: row.job_id,
        ...dispatch,
        ...(unresolved ? { lease_token: crypto.randomUUID(), fencing: 2 } : {}),
      });
    else
      insert(db, "v2_storage_paid_executions", {
        attempt_id: row.attempt_id,
        plan_id: row.plan_id,
        operation_id: row.operation_id,
        operation_revision: row.operation_revision,
        reservation_id: row.reservation_id,
        blob_id: row.blob_id,
        target_kind: row.target_kind,
        target_id: row.target_id,
        target_revision: row.target_revision,
        scope: row.scope,
        pricing_proof_id: financial.pricing,
        funding_proof_id: financial.funding,
        digest: row.digest,
        payload_json: payload,
        anchor_json: row.anchor_json,
        evidence_hash: row.evidence_hash,
        verified_at: row.verified_at,
        deadline_at: row.deadline_at,
        created_at: row.created_at,
        ...dispatch,
      });
    if (unresolved) {
      insert(db, "v2_cost_receipts", {
        id: crypto.randomUUID(),
        attempt_id: row.attempt_id,
        previous_state: "reserved",
        next_state: "ambiguous",
      });
      insert(db, "v2_runtime_usage", {
        id: crypto.randomUUID(),
        attempt_id: row.attempt_id,
        digest: HASH,
        payload_json: JSON.stringify({ synthetic: true, transport: "unknown" }),
        evidence_hash: OTHER_HASH,
        observed_at: LATER,
        outcome: "ambiguous",
        charged_krw: null,
      });
    }
  })();
}

function observation(attempt: Row): Row {
  const id = crypto.randomUUID();
  return {
    id,
    attempt_id: attempt.attempt_id,
    digest: HASH,
    payload_json: JSON.stringify({
      id,
      attemptId: attempt.attempt_id,
      invocationId: attempt.invocation_id,
      providerRequestId: null,
      dispatchToken: null,
      observedAt: LATER,
      transport: "not_sent",
      definitiveNoCharge: true,
      meteringComplete: false,
      quantities: [],
      chargedUsd: null,
      modelTokenDetails: null,
    }),
    evidence_hash: OTHER_HASH,
    verified_at: LATER,
    observed_at: LATER,
    pricing_proof_id: null,
    funding_proof_id: null,
    pricing_status: "missing",
    funding_status: "missing",
    charged_usd: null,
    charged_krw: null,
  };
}

test("0015 to 0016 preserves every historical table row, priced hold, unknown receipt and exact financial amount", async () => {
  const { db, principalId } = await fixture(true);
  const money = financialFixture(db);
  insertLegacy(db, admission(principalId), money);
  insertLegacy(db, admission(principalId, "storage"), money, true);
  insert(db, "app_metadata", { key: "synthetic-preserve-sentinel", value: "과거 원문 그대로 😀" });
  const tables = (
    db.sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='app_metadata' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
  const prior = tables.map((table) =>
    db.sqlite.query(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
  );
  const sentinel = db.sqlite
    .query("SELECT * FROM app_metadata WHERE key='synthetic-preserve-sentinel'")
    .get();
  const migration = await Bun.file("drizzle/0016_unpriced_execution.sql").text();
  db.sqlite.transaction(() => db.sqlite.exec(migration))();
  expect(
    tables.map((table) => db.sqlite.query(`SELECT * FROM "${table}" ORDER BY rowid`).all()),
  ).toEqual(prior);
  expect(
    db.sqlite.query("SELECT * FROM app_metadata WHERE key='synthetic-preserve-sentinel'").get(),
  ).toEqual(sentinel);
  expect(
    db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0016_unpriced_execution" });
  for (const [view, table] of [
    ["v2_execution_job_plans", "v2_runtime_plans"],
    ["v2_execution_job_holds", "v2_paid_holds"],
    ["v2_execution_attempts", "v2_cost_attempts"],
    ["v2_execution_storage_holds", "v2_storage_paid_executions"],
  ])
    expect(db.sqlite.query(`SELECT * FROM ${view}`).all()).toEqual(
      db.sqlite.query(`SELECT * FROM ${table}`).all(),
    );
  expect(db.sqlite.query("SELECT * FROM v2_execution_admissions").all()).toEqual([]);
  expect(db.sqlite.query("SELECT * FROM v2_execution_cost_observations").all()).toEqual([]);
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("fresh journal and compatibility views retain unknown money as NULL and do not synthesize financial evidence", async () => {
  const { db, principalId } = await fixture();
  const job = admission(principalId),
    storage = admission(principalId, "storage");
  insert(db, "v2_execution_admissions", job);
  insert(db, "v2_execution_admissions", storage);
  insert(db, "v2_execution_cost_observations", observation(job));
  expect(
    db.sqlite
      .query(
        "SELECT id,pricing_proof_id,funding_proof_id,reserved_krw,deadline_at,created_at FROM v2_execution_job_plans",
      )
      .get(),
  ).toEqual({
    id: job.plan_id,
    pricing_proof_id: null,
    funding_proof_id: null,
    reserved_krw: null,
    deadline_at: DEADLINE,
    created_at: NOW,
  });
  expect(
    db.sqlite.query("SELECT attempt_id,plan_id,job_id,state FROM v2_execution_job_holds").get(),
  ).toEqual({
    attempt_id: job.attempt_id,
    plan_id: job.plan_id,
    job_id: job.job_id,
    state: "prepared",
  });
  expect(
    db.sqlite
      .query(
        "SELECT attempt_id,reservation_id,blob_id,anchor_json,pricing_proof_id,funding_proof_id FROM v2_execution_storage_holds",
      )
      .get(),
  ).toEqual({
    attempt_id: storage.attempt_id,
    reservation_id: storage.reservation_id,
    blob_id: storage.blob_id,
    anchor_json: storage.anchor_json,
    pricing_proof_id: null,
    funding_proof_id: null,
  });
  expect(
    db.sqlite
      .query("SELECT month,quote_id,reserved_krw,charged_krw FROM v2_execution_attempts")
      .all(),
  ).toEqual([
    { month: null, quote_id: null, reserved_krw: null, charged_krw: null },
    { month: null, quote_id: null, reserved_krw: null, charged_krw: null },
  ]);
  for (const table of [
    "v2_runtime_proofs",
    "v2_runtime_plans",
    "v2_cost_quotes",
    "v2_cost_attempts",
    "v2_cost_receipts",
    "v2_runtime_usage",
    "v2_monthly_budget",
    "v2_runtime_controls",
  ])
    expect(db.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

const requiredJobPaths = [
  "attemptId",
  "planId",
  "plan",
  "plan.operationId",
  "plan.operationRevision",
  "plan.requestHash",
  "plan.invocationId",
  "attempt",
  "targetKind",
  "targetId",
  "targetRevision",
  "plan.deadlineAt",
  "plan.maximumAttempts",
  "plan.quantities",
  "service",
  "jobId",
];
for (const path of requiredJobPaths)
  test(`journal rejects missing or null required execution payload field ${path}`, async () => {
    const { db, principalId } = await fixture();
    for (const value of [MISSING, null]) {
      const row = admission(principalId);
      payloadField(row, path, value);
      expect(() => insert(db, "v2_execution_admissions", row)).toThrow();
    }
    expect(db.sqlite.query("SELECT * FROM v2_execution_admissions").all()).toEqual([]);
  });

for (const path of ["reservationId", "blobId", "intent.kind"])
  test(`storage journal rejects missing, null or mismatched immutable payload field ${path}`, async () => {
    const { db, principalId } = await fixture();
    for (const value of [MISSING, null, "different-binding"]) {
      const row = admission(principalId, "storage");
      payloadField(row, path, value);
      expect(() => insert(db, "v2_execution_admissions", row)).toThrow();
    }
  });

test("journal enforces integer revision/attempt/fence bounds, deadlines, quantity count and UTF-8 payload/anchor size", async () => {
  const { db, principalId } = await fixture();
  for (const [column, path] of [
    ["operation_revision", "plan.operationRevision"],
    ["target_revision", "targetRevision"],
    ["attempt", "attempt"],
  ])
    for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const row = bind(admission(principalId), String(column), String(path), value);
      expect(() => insert(db, "v2_execution_admissions", row)).toThrow();
    }
  for (const maximum of [0, 11, 1.5]) {
    const row = admission(principalId);
    payloadField(row, "plan.maximumAttempts", maximum);
    expect(() => insert(db, "v2_execution_admissions", row)).toThrow();
  }
  for (const fence of [0, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      insert(db, "v2_execution_admissions", { ...admission(principalId), fencing: fence }),
    ).toThrow();
  const excessAttempt = bind(admission(principalId), "attempt", "attempt", 4);
  expect(() => insert(db, "v2_execution_admissions", excessAttempt)).toThrow();
  const elapsed = bind(admission(principalId), "deadline_at", "plan.deadlineAt", NOW);
  expect(() => insert(db, "v2_execution_admissions", elapsed)).toThrow();
  expect(() =>
    insert(db, "v2_execution_admissions", { ...admission(principalId), verified_at: LATER }),
  ).toThrow();
  for (const quantities of [
    [],
    Array.from({ length: 33 }, () => ({ sku: "worker_requests", maximumQuantity: "1" })),
  ]) {
    const row = admission(principalId);
    payloadField(row, "plan.quantities", quantities);
    expect(() => insert(db, "v2_execution_admissions", row)).toThrow();
  }
  const oversized = admission(principalId);
  payloadField(oversized, "padding", "한".repeat(22000));
  expect(String(oversized.payload_json).length).toBeLessThan(65536);
  expect(() => insert(db, "v2_execution_admissions", oversized)).toThrow();
  const anchor = {
    ...admission(principalId, "storage"),
    anchor_json: JSON.stringify({ data: "한".repeat(350000) }),
  };
  expect(String(anchor.anchor_json).length).toBeLessThan(1048576);
  expect(() => insert(db, "v2_execution_admissions", anchor)).toThrow();
  expect(db.sqlite.query("SELECT * FROM v2_execution_admissions").all()).toEqual([]);
});

for (const newKind of ["job", "storage"] as const)
  for (const legacyKind of ["job", "storage"] as const)
    for (const order of ["unpriced-first", "priced-first"] as const)
      test(`${order} prevents ${newKind} journal and ${legacyKind} legacy plan ID collision without partial writes`, async () => {
        const { db, principalId } = await fixture();
        const financial = financialFixture(db),
          newer = admission(principalId, newKind),
          older = admission(principalId, legacyKind);
        bind(older, "plan_id", "planId", newer.plan_id ?? null);
        if (order === "unpriced-first") insert(db, "v2_execution_admissions", newer);
        else insertLegacy(db, older, financial);
        const before = db.sqlite.serialize();
        expect(() =>
          order === "unpriced-first"
            ? insertLegacy(db, older, financial)
            : insert(db, "v2_execution_admissions", newer),
        ).toThrow(/EXECUTION_(PLAN|ATTEMPT)_CONFLICT/);
        expect(db.sqlite.serialize()).toEqual(before);
        expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      });

test("unresolved invocation locks and exact attempt identity span both routes and remain after completion", async () => {
  const { db, principalId } = await fixture();
  const money = financialFixture(db),
    first = admission(principalId);
  insert(db, "v2_execution_admissions", first);
  const sameInvocation = bind(
    admission(principalId),
    "invocation_id",
    "plan.invocationId",
    first.invocation_id ?? null,
  );
  bind(sameInvocation, "attempt", "attempt", 2);
  expect(() => insert(db, "v2_execution_admissions", sameInvocation)).toThrow(
    "EXECUTION_ATTEMPT_CONFLICT",
  );
  expect(() => insertLegacy(db, sameInvocation, money)).toThrow("EXECUTION_ATTEMPT_CONFLICT");
  db.sqlite
    .query(
      "UPDATE v2_execution_admissions SET state='final',transport='not_sent',transport_observed_at=?,transport_digest=? WHERE attempt_id=?",
    )
    .run(LATER, HASH, first.attempt_id ?? null);
  const duplicate = bind(
    admission(principalId),
    "attempt_id",
    "attemptId",
    first.attempt_id ?? null,
  );
  expect(() => insertLegacy(db, duplicate, money)).toThrow("EXECUTION_ATTEMPT_CONFLICT");
  const sameOrdinal = bind(
    admission(principalId),
    "invocation_id",
    "plan.invocationId",
    first.invocation_id ?? null,
  );
  expect(() => insertLegacy(db, sameOrdinal, money)).toThrow("EXECUTION_ATTEMPT_CONFLICT");
  insert(db, "v2_execution_admissions", sameInvocation);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_execution_admissions").get()).toEqual({
    n: 2,
  });
});

for (const kind of ["job", "storage"] as const)
  for (const unresolved of [false, true])
    test(`legacy ${kind} ${unresolved ? "ambiguous" : "reserved"} execution blocks colliding unpriced attempts without altering its ledger`, async () => {
      const { db, principalId } = await fixture();
      const money = financialFixture(db),
        older = admission(principalId, kind);
      insertLegacy(db, older, money, unresolved);
      const before = db.sqlite.serialize();
      const sameId = bind(
        admission(principalId),
        "attempt_id",
        "attemptId",
        older.attempt_id ?? null,
      );
      const sameInvocation = bind(
        admission(principalId),
        "invocation_id",
        "plan.invocationId",
        older.invocation_id ?? null,
      );
      for (const newer of [sameId, sameInvocation])
        expect(() => insert(db, "v2_execution_admissions", newer)).toThrow(
          "EXECUTION_ATTEMPT_CONFLICT",
        );
      bind(sameInvocation, "attempt", "attempt", 2);
      expect(() => insert(db, "v2_execution_admissions", sameInvocation)).toThrow(
        "EXECUTION_ATTEMPT_CONFLICT",
      );
      expect(db.sqlite.serialize()).toEqual(before);
    });

test("journal binding and dispatch identity cannot be rewritten, deleted or reopened after terminal observation", async () => {
  const { db, principalId } = await fixture();
  const row = admission(principalId);
  insert(db, "v2_execution_admissions", row);
  const dispatch =
    "state='dispatched',lease_token='synthetic-lease',fencing=1,dispatch_token='synthetic-dispatch',dispatched_at=?";
  for (const [column, value] of [
    ["evidence_hash", HASH],
    ["environment", "production"],
    ["created_at", LATER],
    ["runtime_instance_id", "different-workflow-run"],
  ])
    expect(() =>
      db.sqlite
        .query(`UPDATE v2_execution_admissions SET ${dispatch},${column}=? WHERE attempt_id=?`)
        .run(LATER, value ?? null, row.attempt_id ?? null),
    ).toThrow("EXECUTION_BINDING_IMMUTABLE");
  expect(() =>
    db.sqlite
      .query("DELETE FROM v2_execution_admissions WHERE attempt_id=?")
      .run(row.attempt_id ?? null),
  ).toThrow("EXECUTION_HISTORY_IMMUTABLE");
  expect(() =>
    db.sqlite
      .query("UPDATE v2_execution_admissions SET state='dispatched' WHERE attempt_id=?")
      .run(row.attempt_id ?? null),
  ).toThrow();
  db.sqlite
    .query(`UPDATE v2_execution_admissions SET ${dispatch} WHERE attempt_id=?`)
    .run(LATER, row.attempt_id ?? null);
  const unknown = "state='unknown',transport='unknown',transport_observed_at=?,transport_digest=?";
  for (const [column, value] of [
    ["dispatch_token", "different-token"],
    ["lease_token", "different-lease"],
    ["fencing", 2],
    ["dispatched_at", DEADLINE],
  ] as const)
    expect(() =>
      db.sqlite
        .query(`UPDATE v2_execution_admissions SET ${unknown},${column}=? WHERE attempt_id=?`)
        .run(LATER, HASH, value, row.attempt_id ?? null),
    ).toThrow("EXECUTION_STATE_CONFLICT");
  db.sqlite
    .query(`UPDATE v2_execution_admissions SET ${unknown} WHERE attempt_id=?`)
    .run(LATER, HASH, row.attempt_id ?? null);
  expect(() =>
    db.sqlite
      .query(
        `UPDATE v2_execution_admissions SET ${dispatch},transport=NULL,transport_observed_at=NULL,transport_digest=NULL WHERE attempt_id=?`,
      )
      .run(LATER, row.attempt_id ?? null),
  ).toThrow("EXECUTION_STATE_CONFLICT");
  db.sqlite
    .query(
      "UPDATE v2_execution_admissions SET state='final',transport='response',transport_observed_at=?,transport_digest=? WHERE attempt_id=?",
    )
    .run(DEADLINE, OTHER_HASH, row.attempt_id ?? null);
  expect(() =>
    db.sqlite
      .query(`UPDATE v2_execution_admissions SET ${unknown} WHERE attempt_id=?`)
      .run(DEADLINE, HASH, row.attempt_id ?? null),
  ).toThrow("EXECUTION_STATE_CONFLICT");
  expect(
    db.sqlite
      .query(
        "SELECT state,dispatch_token,lease_token,fencing,transport FROM v2_execution_admissions",
      )
      .get(),
  ).toEqual({
    state: "final",
    dispatch_token: "synthetic-dispatch",
    lease_token: "synthetic-lease",
    fencing: 1,
    transport: "response",
  });
});

test("optional cost observations keep missing money nullable, reject invented zero and are append-only", async () => {
  const { db, principalId } = await fixture();
  const row = admission(principalId);
  insert(db, "v2_execution_admissions", row);
  const receipt = observation(row);
  expect(() =>
    insert(db, "v2_execution_cost_observations", { ...receipt, charged_krw: 0 }),
  ).toThrow();
  insert(db, "v2_execution_cost_observations", receipt);
  expect(
    db.sqlite
      .query(
        "SELECT pricing_proof_id,funding_proof_id,charged_usd,charged_krw FROM v2_execution_cost_observations",
      )
      .get(),
  ).toEqual({
    pricing_proof_id: null,
    funding_proof_id: null,
    charged_usd: null,
    charged_krw: null,
  });
  expect(() =>
    db.sqlite.exec(
      "UPDATE v2_execution_cost_observations SET observed_at='2026-10-15T00:00:00.000Z'",
    ),
  ).toThrow("EXECUTION_OBSERVATION_IMMUTABLE");
  expect(() => db.sqlite.exec("DELETE FROM v2_execution_cost_observations")).toThrow(
    "EXECUTION_OBSERVATION_IMMUTABLE",
  );
  expect(() =>
    insert(
      db,
      "v2_execution_cost_observations",
      (() => {
        const duplicate = { ...receipt, id: crypto.randomUUID() };
        payloadField(duplicate, "id", duplicate.id);
        return duplicate;
      })(),
    ),
  ).toThrow();
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_execution_cost_observations").get()).toEqual(
    { n: 1 },
  );
});

test("storage source anchor and blob binding remain immutable through one-shot dispatch", async () => {
  const { db, principalId } = await fixture();
  const row = admission(principalId, "storage");
  insert(db, "v2_execution_admissions", row);
  const dispatch = "state='dispatched',dispatch_token='storage-dispatch',dispatched_at=?";
  expect(() =>
    db.sqlite
      .query(`UPDATE v2_execution_admissions SET ${dispatch},anchor_json=? WHERE attempt_id=?`)
      .run(LATER, JSON.stringify({ source: "different source" }), row.attempt_id ?? null),
  ).toThrow("EXECUTION_BINDING_IMMUTABLE");
  const rewritten = bind({ ...row }, "blob_id", "blobId", crypto.randomUUID());
  expect(() =>
    db.sqlite
      .query(
        `UPDATE v2_execution_admissions SET ${dispatch},blob_id=?,payload_json=? WHERE attempt_id=?`,
      )
      .run(
        LATER,
        rewritten.blob_id ?? null,
        rewritten.payload_json ?? null,
        row.attempt_id ?? null,
      ),
  ).toThrow("EXECUTION_BINDING_IMMUTABLE");
  db.sqlite
    .query(`UPDATE v2_execution_admissions SET ${dispatch} WHERE attempt_id=?`)
    .run(LATER, row.attempt_id ?? null);
  expect(() =>
    db.sqlite
      .query(`UPDATE v2_execution_admissions SET ${dispatch} WHERE attempt_id=?`)
      .run(LATER, row.attempt_id ?? null),
  ).toThrow("EXECUTION_STATE_CONFLICT");
  expect(
    db.sqlite.query("SELECT blob_id,anchor_json,dispatch_token FROM v2_execution_admissions").get(),
  ).toEqual({
    blob_id: row.blob_id,
    anchor_json: row.anchor_json,
    dispatch_token: "storage-dispatch",
  });
});

for (const path of ["id", "attemptId", "observedAt", "transport", "quantities"])
  test(`observation payload cannot omit or null its ${path} binding`, async () => {
    const { db, principalId } = await fixture();
    const attempt = admission(principalId);
    insert(db, "v2_execution_admissions", attempt);
    for (const value of [MISSING, null]) {
      const receipt = observation(attempt);
      payloadField(receipt, path, value);
      expect(() => insert(db, "v2_execution_cost_observations", receipt)).toThrow();
    }
  });

test("observations require an explicit nullable USD field and consistent proof references", async () => {
  const { db, principalId } = await fixture();
  const attempt = admission(principalId);
  insert(db, "v2_execution_admissions", attempt);
  const omitted = observation(attempt);
  payloadField(omitted, "chargedUsd", MISSING);
  expect(() => insert(db, "v2_execution_cost_observations", omitted)).toThrow();
  const money = financialFixture(db);
  for (const change of [
    { pricing_proof_id: money.pricing },
    { funding_proof_id: money.funding },
    { pricing_status: "current" },
    { funding_status: "current" },
    { pricing_status: "stale" },
    { funding_status: "unavailable" },
  ])
    expect(() =>
      insert(db, "v2_execution_cost_observations", { ...observation(attempt), ...change }),
    ).toThrow();
  const actualUsd = observation(attempt);
  actualUsd.charged_usd = "0.0001";
  payloadField(actualUsd, "chargedUsd", "0.0001");
  payloadField(actualUsd, "transport", "response");
  payloadField(actualUsd, "definitiveNoCharge", false);
  actualUsd.pricing_proof_id = money.pricing;
  actualUsd.pricing_status = "stale";
  insert(db, "v2_execution_cost_observations", actualUsd);
  expect(
    db.sqlite
      .query("SELECT charged_usd,charged_krw,pricing_status FROM v2_execution_cost_observations")
      .get(),
  ).toEqual({
    charged_usd: "0.0001",
    charged_krw: null,
    pricing_status: "stale",
  });
});

test("observation checks reject inconsistent USD, unverified future time, invalid hashes and oversized payloads", async () => {
  const { db, principalId } = await fixture();
  const attempt = admission(principalId);
  insert(db, "v2_execution_admissions", attempt);
  for (const change of [
    { charged_usd: "1" },
    { digest: "not-a-digest" },
    { evidence_hash: "z".repeat(64) },
    { verified_at: NOW },
  ])
    expect(() =>
      insert(db, "v2_execution_cost_observations", { ...observation(attempt), ...change }),
    ).toThrow();
  const large = observation(attempt);
  payloadField(large, "padding", "한".repeat(22000));
  expect(() => insert(db, "v2_execution_cost_observations", large)).toThrow();
  const quantities = observation(attempt);
  payloadField(
    quantities,
    "quantities",
    Array.from({ length: 33 }, () => ({ sku: "worker_requests", quantity: "1" })),
  );
  expect(() => insert(db, "v2_execution_cost_observations", quantities)).toThrow();
});
