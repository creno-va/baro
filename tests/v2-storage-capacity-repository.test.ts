import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import type { CostSku } from "../src/server/db/v2-paid-contracts";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PricingProof,
  type RuntimeProofVerifier,
} from "../src/server/db/v2-paid-runtime";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import {
  createV2StorageCapacityRepository,
  isPreparedPhysicalCapacity,
  type StorageProjection,
} from "../src/server/db/v2-storage-capacity";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z",
  LATER = "2026-10-06T00:02:00.000Z",
  EXP = "2026-11-01T00:00:00.000Z",
  HASH = "a".repeat(64);
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
// Explicit synthetic authenticator. This is not actual pricing/funding/provider
// evidence, and no network/cloud/model call is performed by this suite.
const verifier: RuntimeProofVerifier = async (kind, _payload, digest) => ({
  digest,
  evidenceHash: "e".repeat(64),
  method:
    kind === "funding"
      ? "authenticated_console"
      : kind === "pricing"
        ? "official_document"
        : kind === "usage"
          ? "provider_receipt"
          : "authenticated_coordinator",
  verifiedAt: NOW,
});
function allocation(version = 1): BudgetAllocation {
  return {
    month: "2026-10",
    version,
    previewKrw: 10000,
    productionKrw: 20000,
    sharedFixedKrw: 100,
    maintenanceReserveKrw: 100,
    pricingProvenance: "synthetic public pricing",
    fxProvenance: "synthetic FX",
    fundingProvenance: "synthetic console",
    reviewedAt: NOW,
    validUntil: EXP,
    fundingState: "trial_credit",
    fundingValidUntil: EXP,
    manifestHash: HASH,
  };
}
function pricing(): PricingProof {
  return {
    id: crypto.randomUUID(),
    version: 1,
    environment: "preview",
    modelBillingPolicy: {
      contextThresholdTokens: 272000,
      serviceTier: "default",
      processingRegion: "global",
      regionMultiplier: "1",
    },
    prices: [
      "r2_class_a_requests",
      "r2_class_b_requests",
      "r2_storage_gb_months",
      "worker_requests",
      "worker_cpu_ms",
      "d1_rows_read",
      "d1_rows_written",
    ].map((sku) => ({
      sku: sku as CostSku,
      modelRates: null,
      provider: "cloudflare" as const,
      model: null,
      region: "global",
      plan: "standard",
      billingMode: "metered" as const,
      unit:
        sku === "r2_storage_gb_months"
          ? "gb_months"
          : sku === "worker_cpu_ms"
            ? "milliseconds"
            : sku.startsWith("d1_")
              ? "rows"
              : "requests",
      unitSize: "1",
      usdPerUnit: "0.000001",
      billingQuantum: "1",
      officialUrl: "https://developers.cloudflare.com/r2/pricing/",
      checkedAt: NOW,
      validUntil: EXP,
    })),
    fx: {
      krwPerUsd: "1000",
      authority: "synthetic authority",
      referenceUrl: "https://example.test/fx",
      asOf: NOW,
      checkedAt: NOW,
      validUntil: EXP,
    },
    taxRatio: "0",
    feeRatio: "0",
    safetyMarginRatio: "0",
    hiddenAttemptMultiplier: 1,
    hiddenRetryReference: "synthetic reviewed bound",
    checkedAt: NOW,
    validUntil: EXP,
  };
}
function funding(): FundingProof {
  return {
    id: crypto.randomUUID(),
    environment: "preview",
    state: "trial_credit",
    existingPaymentPath: true,
    autoRecharge: false,
    spendAllowanceKrw: 10000,
    reference: "synthetic-credit-observation",
    observedAt: NOW,
    validUntil: EXP,
  };
}
async function fixture(options: { throughMigration?: string } = {}) {
  const db = await createTestDatabase(options);
  dbs.push(db);
  const session = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/u, ""),
  });
  const core = createV2Core(db.binding, cipher),
    actor: Actor = { ownerId: session.userId, now: NOW };
  const accounting = createV2AccountingRepository(core, "preview"),
    jobs = createV2JobsRepository(core),
    runtime = createV2PaidRuntimeRepository(core, "preview", verifier);
  await accounting.ensurePrincipal(actor);
  const a = allocation();
  await accounting.recordAllocation(a);
  for (const environment of ["preview", "production"] as const)
    await accounting.recordAllocationAcknowledgment({
      month: a.month,
      version: a.version,
      environment,
      manifestHash: HASH,
      drainReceiptId: crypto.randomUUID(),
      now: NOW,
    });
  expect(await accounting.activateAllocation(a.month, a.version, NOW)).toBe(true);
  expect(await runtime.initializeControl(a.month, NOW)).toBe(true);
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await runtime.putAllocationProof(ap, NOW)).toBe(true);
  const drain = await runtime.drain(a.month, 1, ap.id, NOW);
  expect(drain).not.toBeNull();
  if (!drain) throw new Error("synthetic fixture drain missing");
  expect(await runtime.putRemoteDrainProof(drain, NOW)).toBe(true);
  const remote = {
    ...drain,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  expect(await runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
  expect(await runtime.activate(a.month, 2, ap.id, drain.id, remote.id, NOW)).toBe(true);
  const pp = pricing(),
    fp = funding();
  expect(await runtime.putPricingProof(pp, NOW)).toBe(true);
  expect(await runtime.putFundingProof(fp, NOW)).toBe(true);
  const workspaceId = crypto.randomUUID();
  const envelope = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, envelope, NOW, NOW);
  return { db, core, actor, accounting, jobs, runtime, pp, fp, workspaceId, ap, drain, remote };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function projection(f: Fixture, extra: Partial<StorageProjection> = {}): StorageProjection {
  return {
    id: crypto.randomUUID(),
    month: "2026-10",
    capacityBytes: 100000000000,
    storageClass: "standard",
    pricingProofId: f.pp.id,
    fundingProofId: f.fp.id,
    allocationProofId: f.ap.id,
    expectedControlRevision: 4,
    inventoryHash: HASH,
    getLimit: 2,
    headLimit: 2,
    deleteLimit: 4,
    workerCpuMsPerIO: 100,
    d1RowsReadPerIO: 100,
    d1RowsWrittenPerIO: 100,
    ...extra,
  };
}
async function ready(extra: Partial<StorageProjection> = {}) {
  const f = await fixture(),
    capacity = createV2StorageCapacityRepository(f.core, "preview", verifier);
  expect(await f.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  const p = projection(f, extra);
  expect(await capacity.reserveProjection(p, NOW)).toBe(true);
  const d = await f.runtime.drain("2026-10", 5, f.ap.id, NOW);
  if (!d) throw Error("synthetic drain missing");
  expect(await f.runtime.putRemoteDrainProof(d, NOW)).toBe(true);
  const r = { ...d, id: crypto.randomUUID(), environment: "production" as const, limitKrw: 20000 };
  expect(await f.runtime.putRemoteDrainProof(r, NOW)).toBe(true);
  expect(await f.runtime.activate("2026-10", 6, f.ap.id, d.id, r.id, NOW)).toBe(true);
  return { ...f, capacity, p };
}
// Direct SQL seeds only the existing upload reservation/opaque pending intent;
// the new atomic capacity statements, AES and generated migration run for real.
async function intent(f: Fixture, kind = "original", visibility = "private") {
  const id = crypto.randomUUID(),
    reservationId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,created_at) SELECT ?,id,?,?,?,'derived_report',100,? FROM v2_billing_principals WHERE owner_id=?",
    )
    .run(reservationId, operationId, id, id, NOW, f.actor.ownerId);
  f.db.sqlite
    .query(
      "UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes+100 WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)",
    )
    .run(f.actor.ownerId);
  const encrypted = await f.core.encrypt("v2_blobs", id, f.actor.ownerId, 1, { contentHash: HASH });
  const input = {
    blobId: id,
    ownerId: f.actor.ownerId,
    objectKey: `${visibility === "public" ? "public" : "private"}/${id}`,
    maximumCipherBytes: 100,
  };
  const statement = (claim?: string) =>
    f.core.statement(
      `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,object_key,logical_bytes,cipher_bytes,encrypted_payload,created_at,source_blob_id,source_asset_revision,approved_revision_id) SELECT ?,id,?,?,?,?,100,0,?,?,?, ?,? FROM v2_billing_principals WHERE owner_id=? ${claim ? "AND EXISTS(SELECT 1 FROM v2_mutation_claims WHERE id=?)" : ""}`,
      [
        id,
        reservationId,
        kind,
        visibility,
        input.objectKey,
        encrypted,
        NOW,
        visibility === "public" ? crypto.randomUUID() : null,
        visibility === "public" ? 1 : null,
        visibility === "public" ? crypto.randomUUID() : null,
        f.actor.ownerId,
        ...(claim ? [claim] : []),
      ],
    );
  return { input, statement, id, reservationId, encrypted };
}
async function admit(
  f: Awaited<ReturnType<typeof ready>>,
  i: Awaited<ReturnType<typeof intent>>,
  insert = true,
) {
  const prepared = f.capacity.prepareCapacity(f.actor, i.input),
    claim = crypto.randomUUID();
  return f.core.changed([
    f.core.claim(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      claim,
      prepared.predicate.sql,
      [...prepared.predicate.values],
    ),
    ...(insert ? [i.statement(claim)] : []),
    ...prepared.statements(f.core, f.actor, claim),
    f.core.finish(claim),
  ]);
}
function held(f: Fixture) {
  return f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get() as {
    held_bytes: number;
  };
}
async function deleteActual(f: Fixture, id: string) {
  const journalId = crypto.randomUUID(),
    token = crypto.randomUUID(),
    receiptId = crypto.randomUUID();
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='deleting',cipher_hash=?,cipher_bytes=100 WHERE id=?")
    .run(HASH, id);
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_journals(id,target_kind,target_id,state,fencing,lease_token,lease_until,created_at,next_attempt_at) VALUES(?,'blob',?,'running',1,?,?,?,?)",
    )
    .run(journalId, crypto.randomUUID(), token, EXP, NOW, NOW);
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) VALUES(?,0,'blob',?)",
    )
    .run(journalId, id);
  return createV2StorageRepository(f.core).confirmBlobDeleted(id, NOW, {
    lease: { journalId, token, fencing: 1 },
    receiptId,
    objectKey: `private/${id}`,
    cipherHash: HASH,
  });
}

test("authenticated projection reserves exact estimates without fabricating a settled bill; repeats never reset counters", async () => {
  const f = await ready();
  const m = f.db.sqlite
    .query("SELECT state,amount_krw FROM v2_maintenance_exposure WHERE id=?")
    .get(f.p.id) as { state: string; amount_krw: number };
  expect(m.state).toBe("reserved");
  expect(m.amount_krw).toBeGreaterThan(0);
  expect(await f.capacity.reserveProjection(f.p, NOW)).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_maintenance_exposure").get()).toEqual({
    n: 1,
  });
});
test("missing verifier and stale control/proof/configuration fail closed", async () => {
  const f = await fixture(),
    capacity = createV2StorageCapacityRepository(f.core, "preview", verifier);
  expect(await f.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  expect(
    await createV2StorageCapacityRepository(f.core, "preview").reserveProjection(
      projection(f),
      NOW,
    ),
  ).toBe(false);
  expect(
    await capacity.reserveProjection(projection(f, { expectedControlRevision: 99 }), NOW),
  ).toBe(false);
  const short = { ...f.fp, id: crypto.randomUUID(), validUntil: LATER };
  expect(await f.runtime.putFundingProof(short, NOW)).toBe(true);
  expect(await capacity.reserveProjection(projection(f, { fundingProofId: short.id }), NOW)).toBe(
    false,
  );
  expect(held(f)).toBeNull();
});
test("maximum is 100GB physical cipher capacity, pending claim rollback is atomic and non-forgeable", async () => {
  const f = await ready(),
    i = await intent(f);
  const p = f.capacity.prepareCapacity(f.actor, i.input);
  expect(isPreparedPhysicalCapacity(p)).toBe(true);
  expect(isPreparedPhysicalCapacity({ ...p })).toBe(false);
  await expect(admit(f, i, false)).rejects.toThrow();
  expect(held(f)).toEqual({ held_bytes: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
  expect(await admit(f, i)).toBe(true);
  expect(held(f)).toEqual({ held_bytes: 100 });
  expect(() =>
    f.capacity.prepareCapacity(f.actor, { ...i.input, maximumCipherBytes: 100000000001 }),
  ).toThrow();
  expect(() =>
    f.capacity.prepareCapacity(f.actor, { ...i.input, ownerId: "foreign-owner" }),
  ).toThrow();
  expect(() => p.statements(f.core, { ...f.actor, now: LATER }, crypto.randomUUID())).toThrow();
});
test("concurrent last-slot claims across original/derivative/public share one physical ceiling", async () => {
  const f = await ready({ capacityBytes: 200 }),
    a = await intent(f),
    b = await intent(f, "derivative", "staging"),
    c = await intent(f, "public_copy", "public");
  const results = await Promise.all([admit(f, a), admit(f, b), admit(f, c)]);
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(held(f)).toEqual({ held_bytes: 200 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 2 });
});
test("writer capability validates returned key/size, denies clones and never permits a second dispatch", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const w = await f.capacity.beginWrite(i.id, 100, NOW);
  expect(w).not.toBeNull();
  if (!w) throw Error("no writer");
  expect(await f.capacity.beginWrite(i.id, 100, NOW)).toBeNull();
  expect(
    await f.capacity.confirmWriterStopped(
      { ...w },
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: "private/wrong", byteLength: 100 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 99 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      NOW,
    ),
  ).toBe(true);
  expect(await f.capacity.confirmWriterStopped(w, { transport: "not_sent" }, NOW)).toBe(false);
  expect(held(f).held_bytes).toBe(100);
});
test("actual delete while writer is unresolved retains capacity; stopped writer needs a later actual delete receipt", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const w = await f.capacity.beginWrite(i.id, 100, NOW);
  if (!w) throw Error("no writer");
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      LATER,
    ),
  ).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(0);
  expect(await f.capacity.beginWrite(i.id, 100, LATER)).toBeNull();
});
test("never-dispatched cancellation is safely released by actual guarded delete and cannot start later", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(0);
  expect(await f.capacity.beginWrite(i.id, 100, NOW)).toBeNull();
});
test("physical tuple is immutable; hash metadata/AES survives migration and source account removal cannot erase capacity", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  expect(() =>
    f.db.sqlite.query("UPDATE v2_blobs SET cipher_bytes=101 WHERE id=?").run(i.id),
  ).toThrow();
  expect(() =>
    f.db.sqlite.query("UPDATE v2_blobs SET object_key=? WHERE id=?").run("private/other", i.id),
  ).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM v2_physical_blob_bindings")).toThrow();
  expect(() => f.db.sqlite.exec("UPDATE v2_physical_storage_capacity SET held_bytes=0")).toThrow();
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(held(f).held_bytes).toBe(100);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("monthly bounded maintenance permits have exact scope, one use and no refundable unknown exposure", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(i.id);
  const p = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW);
  if (!p) throw Error("no get");
  expect(await f.capacity.consumeMaintenanceIO({ ...p }, NOW)).toBe(false);
  expect(await f.capacity.consumeMaintenanceIO(p, NOW)).toBe(true);
  expect(await f.capacity.consumeMaintenanceIO(p, NOW)).toBe(false);
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW)).not.toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW)).toBeNull();
  expect(
    await f.capacity.beforeMaintenanceIO({ blobId: "foreign-blob", action: "head" }, NOW),
  ).toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "delete" }, NOW)).toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "head" }, EXP)).toBeNull();
  expect(held(f).held_bytes).toBe(100);
});
test("actual populated 0008 -> 0009 preserves session, AES ciphertext, funding and opaque physical pending; explicit inventory is required", async () => {
  const f = await fixture({ throughMigration: "0008_storage_paid_execution" }),
    i = await intent(f);
  await i.statement().run();
  const before = f.db.sqlite.query("SELECT * FROM session").all(),
    budget = f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all();
  f.db.sqlite.exec(await Bun.file("drizzle/0009_storage_capacity_maintenance.sql").text());
  expect(f.db.sqlite.query("SELECT * FROM session").all()).toEqual(before);
  expect(f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all()).toEqual(budget);
  expect(f.db.sqlite.query("SELECT encrypted_payload FROM v2_blobs WHERE id=?").get(i.id)).toEqual({
    encrypted_payload: i.encrypted,
  });
  expect(
    await f.core.cipher.decrypt(i.encrypted, {
      table: "v2_blobs",
      column: "encrypted_payload",
      rowId: i.id,
      userId: f.actor.ownerId,
      revision: 1,
    }),
  ).toBe(JSON.stringify({ contentHash: HASH }));
  expect(await f.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  const capacity = createV2StorageCapacityRepository(f.core, "preview", verifier);
  expect(await capacity.reserveProjection(projection(f), NOW)).toBe(false);
  expect(
    await capacity.bindInventory(
      {
        id: crypto.randomUUID(),
        manifestHash: HASH,
        observedAt: NOW,
        bindings: [{ ...i.input, writerState: "unknown" }],
      },
      NOW,
    ),
  ).toBe(true);
  expect(await capacity.reserveProjection(projection(f), NOW)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
});

test("full ceiling is projected for the complete KST month; monthly rollover cannot reset physical held bytes or reuse I/O permits", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const row = f.db.sqlite
    .query("SELECT payload_json,valid_until FROM v2_storage_projections")
    .get() as { payload_json: string; valid_until: string };
  const payload = JSON.parse(row.payload_json);
  expect(payload.quantities[0]).toEqual({ sku: "r2_storage_gb_months", maximumQuantity: "100" });
  expect(row.valid_until).toBe("2026-10-31T15:00:00.000Z");
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(i.id);
  const permit = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW);
  if (!permit) throw Error("missing permit");
  expect(await f.capacity.consumeMaintenanceIO(permit, "2026-10-31T15:00:00.000Z")).toBe(false);
  expect(held(f).held_bytes).toBe(100);
  const a = {
    ...allocation(),
    month: "2026-11",
    reviewedAt: EXP,
    validUntil: "2026-12-01T00:00:00.000Z",
    fundingValidUntil: "2026-12-01T00:00:00.000Z",
  };
  expect(await f.accounting.recordAllocation(a)).toBe(true);
  for (const environment of ["preview", "production"] as const)
    expect(
      await f.accounting.recordAllocationAcknowledgment({
        month: a.month,
        version: 1,
        environment,
        manifestHash: HASH,
        drainReceiptId: crypto.randomUUID(),
        now: EXP,
      }),
    ).toBe(true);
  expect(await f.accounting.activateAllocation(a.month, 1, EXP)).toBe(true);
  expect(await f.runtime.initializeControl(a.month, EXP)).toBe(true);
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await f.runtime.putAllocationProof(ap, EXP)).toBe(true);
  const d = await f.runtime.drain(a.month, 1, ap.id, EXP);
  if (!d) throw Error("missing drain");
  expect(await f.runtime.putRemoteDrainProof(d, EXP)).toBe(true);
  const remote = {
    ...d,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  expect(await f.runtime.putRemoteDrainProof(remote, EXP)).toBe(true);
  await expect(f.runtime.activate(a.month, 2, ap.id, d.id, remote.id, EXP)).rejects.toThrow();
  expect(held(f).held_bytes).toBe(100);
});

test("paid composition cannot bind a foreign/mismatched pending tuple or silently change an existing capacity binding", async () => {
  const f = await ready(),
    i = await intent(f);
  const fake = { ...i, input: { ...i.input, objectKey: "private/wrong" } };
  await expect(admit(f, fake)).rejects.toThrow();
  expect(held(f).held_bytes).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 0 });
  expect(await admit(f, i)).toBe(true);
  const p = f.capacity.prepareCapacity(f.actor, { ...i.input, maximumCipherBytes: 99 }),
    claim = crypto.randomUUID();
  await expect(
    f.core.changed([
      f.core.claim(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
        claim,
        p.predicate.sql,
        [...p.predicate.values],
      ),
      ...p.statements(f.core, f.actor, claim),
      f.core.finish(claim),
    ]),
  ).rejects.toThrow();
  expect(held(f).held_bytes).toBe(100);
  expect(await f.capacity.beginWrite(i.id, 101, NOW)).toBeNull();
  expect(await f.capacity.beginWrite(i.id, 100, EXP)).toBeNull();
});
