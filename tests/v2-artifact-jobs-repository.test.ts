import { afterEach, beforeEach, expect, test } from "bun:test";
import { createEnvelopeCipher, type EncryptionContext } from "../src/server/crypto";
import {
  createV2AccountingRepository,
  operationStatements,
  quotaStatements,
} from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository, jobInsertStatements } from "../src/server/db/v2-jobs";
import { type BlobRegistration, createV2StorageRepository } from "../src/server/db/v2-storage";
import type { JobLease } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const now = "2026-10-06T00:00:00.000Z";
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let core: ReturnType<typeof createV2Core>;
let jobs: ReturnType<typeof createV2JobsRepository>;
let storage: ReturnType<typeof createV2StorageRepository>;
let deletion: ReturnType<typeof createV2DeletionRepository>;
let actor: { ownerId: string; now: string };
let lease: JobLease;
let beforeEncrypt: ((context: EncryptionContext) => void) | undefined;
let afterDecrypt: ((context: EncryptionContext) => void) | undefined;
let decryptCount: number;
const workspaceId = "workspace_synthetic",
  fileId = "file_synthetic",
  operationId = "operation_synthetic",
  jobId = "job_synthetic";
const blob: BlobRegistration = {
  id: "artifact_synthetic",
  reservationId: "reservation_synthetic",
  kind: "derivative",
  visibility: "private",
  logicalBytes: 100,
  cipherBytes: 132,
  cipherHash: "b".repeat(64),
  contentHash: "a".repeat(64),
  keyVersion: "binary_v1",
};
beforeEach(async () => {
  db = await createTestDatabase();
  beforeEncrypt = undefined;
  afterDecrypt = undefined;
  decryptCount = 0;
  const user = await seedTestSession(db, { now: Date.parse(now), consent: true });
  actor = { ownerId: user.userId, now };
  const cipher = await createEnvelopeCipher({
    activeKeyId: "synthetic",
    keys: { synthetic: btoa("s".repeat(32)).replace(/=+$/, "") },
  });
  core = createV2Core(db.binding, {
    encrypt(value, context) {
      beforeEncrypt?.(context);
      return cipher.encrypt(value, context);
    },
    async decrypt(value, context) {
      decryptCount++;
      const text = await cipher.decrypt(value, context);
      afterDecrypt?.(context);
      return text;
    },
  });
  jobs = createV2JobsRepository(core);
  storage = createV2StorageRepository(core);
  deletion = createV2DeletionRepository(core);
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspace = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, workspace, now, now);
  const file = await core.encrypt("v2_files", fileId, actor.ownerId, 1, {
    name: "synthetic.wav",
    declaredMediaType: "audio/wav",
    probe: null,
  });
  const consent = await core.encrypt("v2_consents", "consent_synthetic", actor.ownerId, 1, {
    accepted: true,
  });
  const claimId = "claim_synthetic";
  expect(
    await core.changed([
      core.claim({ ...actor, workspaceId, expectedRevision: 1 }, claimId),
      ...operationStatements(
        core,
        actor,
        {
          id: operationId,
          workspaceId,
          kind: "file_extract",
          revision: 1,
          route: "/synthetic/file-processing",
          key: "synthetic_processing_key",
          requestHash: blob.contentHash,
        },
        claimId,
      ),
      ...quotaStatements(
        core,
        actor,
        operationId,
        { kind: "media_processing", originalDurationSeconds: 0.5 },
        claimId,
      ),
      core.statement(
        "INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,current_job_id,encrypted_payload,created_at,updated_at) VALUES(?,?,?,'queued',100,?,?,?,?)",
        [fileId, workspaceId, operationId, jobId, file, now, now],
      ),
      core.statement(
        "INSERT INTO v2_consents(id,owner_id,file_id,kind,version,encrypted_payload,created_at) VALUES(?,?,?,'auto_processing','synthetic',?,?)",
        ["consent_synthetic", actor.ownerId, fileId, consent, now],
      ),
      ...jobInsertStatements(
        core,
        actor,
        {
          schemaVersion: "2",
          id: jobId,
          operationId,
          target: { kind: "file", caseId: workspaceId, fileId, fileRevision: 1 },
          kind: "file_processing",
          status: "queued",
          phase: "admission",
          progressPercent: 0,
          attempts: 0,
          failure: null,
          retryable: false,
          updatedAt: now,
        },
        claimId,
      ),
      core.finish(claimId),
    ]),
  ).toBe(true);
  const acquired = await jobs.acquire(actor, jobId, "lease_synthetic", "2026-10-06T00:01:00.000Z");
  if (!acquired) throw new Error("Synthetic job lease unavailable");
  lease = acquired.lease;
  expect(
    await storage.reserveArtifact(
      { ...actor, workspaceId, expectedRevision: 1 },
      {
        id: blob.reservationId,
        artifactId: blob.id,
        target: { kind: "file", id: fileId, revision: 1 },
        operationId,
        byteLength: blob.logicalBytes,
      },
    ),
  ).toBe(true);
});
afterEach(() => {
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  db.close();
});
function tombstone(kind: string, id: string) {
  db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
    .run(kind, id, now);
}
function snapshot() {
  return [
    "v2_jobs",
    "v2_files",
    "v2_workspaces",
    "v2_operations",
    "v2_quota_reservations",
    "v2_daily_usage",
    "v2_blobs",
    "v2_storage_reservations",
    "v2_storage_usage",
    "v2_mutation_claims",
  ].map((table) => db.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

test("renew extends only current lease without changing attempts/fence/revision or consumed media quota", async () => {
  const before = await jobs.find(actor, jobId);
  const quota = db.sqlite.query("SELECT * FROM v2_quota_reservations").all();
  const usage = db.sqlite.query("SELECT * FROM v2_daily_usage").all();
  const workspace = db.sqlite.query("SELECT revision FROM v2_workspaces").get();
  expect(
    await jobs.renew({ ...actor, now: "2026-10-06T00:00:30Z" }, lease, "2026-10-06T00:05:30Z"),
  ).toBe(true);
  expect((await jobs.find(actor, jobId))?.attempts).toBe(before?.attempts);
  expect(db.sqlite.query("SELECT fencing,lease_token,lease_until FROM v2_jobs").get()).toEqual({
    fencing: lease.fencing,
    lease_token: lease.token,
    lease_until: "2026-10-06T00:05:30.000Z",
  });
  expect(db.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual(quota);
  expect(db.sqlite.query("SELECT * FROM v2_daily_usage").all()).toEqual(usage);
  expect(db.sqlite.query("SELECT revision FROM v2_workspaces").get()).toEqual(workspace);
  expect(await jobs.renew(actor, lease, "2026-10-06T00:05:00.001Z")).toBe(false);
  expect(await jobs.renew(actor, lease, "2026-10-06T00:00:00Z")).toBe(false);
});
for (const guard of [
  "token",
  "fence",
  "owner",
  "expired",
  "cancelled",
  "revision",
  "pointer",
  "consent",
  "file",
  "workspace",
  "account",
] as const)
  test(`renew and artifact prepare reject ${guard} without spending or storing object evidence`, async () => {
    let a = actor,
      l = lease;
    if (guard === "token") l = { ...lease, token: "wrong_token" };
    if (guard === "fence") l = { ...lease, fencing: 2 };
    if (guard === "owner") a = { ...actor, ownerId: "foreign_owner" };
    if (guard === "expired") a = { ...actor, now: "2026-10-06T00:01:00.000Z" };
    if (guard === "cancelled") db.sqlite.query("UPDATE v2_jobs SET status='cancelled'").run();
    if (guard === "revision") db.sqlite.query("UPDATE v2_files SET revision=2").run();
    if (guard === "pointer") db.sqlite.query("UPDATE v2_files SET current_job_id=NULL").run();
    if (guard === "consent") db.sqlite.query("DELETE FROM v2_consents").run();
    if (guard === "file" || guard === "workspace" || guard === "account")
      tombstone(
        guard,
        guard === "file" ? fileId : guard === "workspace" ? workspaceId : actor.ownerId,
      );
    const before = snapshot();
    expect(await jobs.renew(a, l, "2026-10-06T00:03:00.000Z")).toBe(false);
    expect(await storage.prepareArtifactBlob(a, l, blob)).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(decryptCount).toBe(0);
  });
test("artifact intent is unreadable before actual receipt and commit remains separate from byte reservation settlement", async () => {
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  expect(await storage.findBlob(actor, blob.id)).toBeNull();
  expect(db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
  expect(await storage.commitArtifactBlob(actor, lease, blob)).toBe(true);
  expect((await storage.findBlob(actor, blob.id))?.cipher_hash).toBe(blob.cipherHash);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 100, stored_bytes: 0 },
  );
  expect(await storage.commitReservation(actor, blob.reservationId)).toBe(true);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 0, stored_bytes: 100 },
  );
  expect(await storage.commitArtifactBlob(actor, lease, blob)).toBe(false);
  expect(await storage.abandonArtifactBlob(actor, blob.id)).toBe(false);
});
test("artifact prepare/commit reject substituted hash/bytes/key/kind/reservation and current fence replacement", async () => {
  expect(await storage.commitArtifactBlob(actor, lease, blob)).toBe(false);
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  const before = snapshot();
  for (const changed of [
    { cipherHash: "c".repeat(64) },
    { contentHash: "d".repeat(64) },
    { cipherBytes: 133 },
    { logicalBytes: 99 },
    { keyVersion: "different_key" },
    { kind: "original" as const },
    { visibility: "staging" as const },
    { reservationId: "foreign_reservation" },
  ])
    expect(await storage.commitArtifactBlob(actor, lease, { ...blob, ...changed })).toBe(false);
  expect(snapshot()).toEqual(before);
  db.sqlite.query("UPDATE v2_jobs SET fencing=2,lease_token='new_lease'").run();
  expect(await storage.commitArtifactBlob(actor, lease, blob)).toBe(false);
  expect(
    await storage.commitArtifactBlob(actor, { ...lease, fencing: 2, token: "new_lease" }, blob),
  ).toBe(false);
  expect(db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
});
test("concurrent artifact prepare and actual receipt publication each admit exactly one winner", async () => {
  expect(
    (
      await Promise.all([
        storage.prepareArtifactBlob(actor, lease, blob),
        storage.prepareArtifactBlob(actor, lease, blob),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  expect(
    (
      await Promise.all([
        storage.commitArtifactBlob(actor, lease, blob),
        storage.commitArtifactBlob(actor, lease, blob),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_blobs").get()).toEqual({ n: 1 });
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
});
test("actual decryption boundary rechecks current file consent and rejects publication after revocation", async () => {
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  afterDecrypt = () => db.sqlite.query("DELETE FROM v2_consents").run();
  expect(await storage.commitArtifactBlob(actor, lease, blob)).toBe(false);
  expect(db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
});
test("prepare encrypt-boundary deletion and final SQL failure cannot expose partial stored artifacts", async () => {
  beforeEncrypt = () => tombstone("file", fileId);
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(false);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_blobs").get()).toEqual({ n: 0 });
  beforeEncrypt = undefined;
  db.sqlite.query("DELETE FROM v2_tombstones").run();
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  db.sqlite.exec(
    "CREATE TRIGGER fail_artifact BEFORE UPDATE OF state ON v2_blobs WHEN NEW.state='stored' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = snapshot();
  await expect(storage.commitArtifactBlob(actor, lease, blob)).rejects.toMatchObject({
    code: "DB_OPERATION_FAILED",
  });
  expect(snapshot()).toEqual(before);
});
test("abandon crashed artifact retains reserved exposure until actual matching R2 cleanup receipt", async () => {
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  expect(await storage.abandonArtifactBlob({ ...actor, ownerId: "foreign_owner" }, blob.id)).toBe(
    false,
  );
  expect(await storage.abandonArtifactBlob(actor, blob.id)).toBe(true);
  expect(db.sqlite.query("SELECT reserved_bytes FROM v2_storage_usage").get()).toEqual({
    reserved_bytes: 100,
  });
  const journal = await deletion.findByTarget("blob", blob.id);
  if (!journal) throw new Error("Synthetic cleanup journal missing");
  const cleanup = await deletion.acquire(
    journal.id,
    "cleanup_synthetic",
    now,
    "2026-10-06T00:01:00.000Z",
  );
  if (!cleanup) throw new Error("Synthetic cleanup lease missing");
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease: cleanup,
      receiptId: "wrong_receipt",
      objectKey: "private/wrong_artifact",
      cipherHash: blob.cipherHash,
    }),
  ).toBe(false);
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease: cleanup,
      receiptId: "actual_receipt_synthetic",
      objectKey: `private/${blob.id}`,
      cipherHash: blob.cipherHash,
    }),
  ).toBe(true);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 0, stored_bytes: 0 },
  );
});

test("crash recovery reads the exact pending tuple and resumes only the original fencing generation", async () => {
  const actual = { ...blob, keyVersion: "artifact_v1" };
  expect(await storage.prepareArtifactBlob(actor, lease, actual)).toBe(true);
  expect(await storage.findBlob(actor, actual.id)).toBeNull();
  expect(await storage.findPendingArtifactBlob(actor, lease, actual.id)).toEqual({
    blob: actual,
    preparedFencing: lease.fencing,
  });
  decryptCount = 0;
  expect(
    await storage.findPendingArtifactBlob({ ...actor, ownerId: "foreign" }, lease, actual.id),
  ).toBeNull();
  expect(decryptCount).toBe(0);
  db.sqlite.query("UPDATE v2_jobs SET fencing=2,lease_token='new_lease'").run();
  const newLease = { ...lease, fencing: 2, token: "new_lease" };
  expect(await storage.findPendingArtifactBlob(actor, lease, actual.id)).toBeNull();
  expect(await storage.findPendingArtifactBlob(actor, newLease, actual.id)).toEqual({
    blob: actual,
    preparedFencing: 1,
  });
  expect(await storage.commitArtifactBlob(actor, newLease, actual)).toBe(false);
  expect(await storage.abandonArtifactBlob(actor, actual.id)).toBe(true);
  expect(await storage.findPendingArtifactBlob(actor, newLease, actual.id)).toBeNull();
});
for (const race of ["consent", "deletion", "ciphertext", "bytes"] as const)
  test(`pending artifact recovery fails closed on ${race} changed during actual AES decryption`, async () => {
    expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
    afterDecrypt = () => {
      afterDecrypt = undefined;
      if (race === "consent") db.sqlite.query("DELETE FROM v2_consents").run();
      if (race === "deletion") tombstone("file", fileId);
      if (race === "ciphertext")
        db.sqlite.query("UPDATE v2_blobs SET encrypted_payload='changed'").run();
      if (race === "bytes")
        db.sqlite.query("UPDATE v2_blobs SET cipher_bytes=cipher_bytes+1").run();
    };
    expect(await storage.findPendingArtifactBlob(actor, lease, blob.id)).toBeNull();
  });
test("same-fence recovery promotes the original verified tuple and pending lookup cannot return a stored winner", async () => {
  expect(await storage.prepareArtifactBlob(actor, lease, blob)).toBe(true);
  const captured = await storage.findPendingArtifactBlob(actor, lease, blob.id);
  if (!captured) throw new Error("Synthetic pending tuple missing");
  // Actual R2 key/size/hash/AEAD verification is the downstream adapter boundary.
  expect(await storage.commitArtifactBlob(actor, lease, captured.blob)).toBe(true);
  expect(await storage.findPendingArtifactBlob(actor, lease, blob.id)).toBeNull();
  expect(await storage.abandonArtifactBlob(actor, blob.id)).toBe(false);
});
