import { afterEach, expect, test } from "bun:test";
import type { V2Coverage, V2Derivative, V2File, V2FileObservation } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { type Actor, createV2Core, fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FileStagingRepository } from "../src/server/db/v2-file-staging";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import {
  type BlobRegistration,
  createV2StorageRepository,
  storageReservationStatements,
} from "../src/server/db/v2-storage";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const HASH = "a".repeat(64);
const CIPHER_HASH = "c".repeat(64);
const CHUNK = 8_388_608;
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("f".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  const actor: Actor = { ownerId: owner.userId, now: NOW };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const envelope = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  database.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, envelope, NOW, NOW);
  database.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(workspaceId);
  return {
    database,
    core,
    actor,
    workspaceId,
    files: createV2FilesRepository(core),
    storage: createV2StorageRepository(core),
    jobs: createV2JobsRepository(core),
    fileStaging: createV2FileStagingRepository(core),
    staging: createV2StagingRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function guard(f: Fixture) {
  const row = f.database.sqlite
    .query("SELECT revision FROM v2_workspaces WHERE id=?")
    .get(f.workspaceId) as { revision: number };
  return { ...f.actor, workspaceId: f.workspaceId, expectedRevision: row.revision };
}
function admission() {
  return { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH };
}
async function reserve(f: Fixture, bytes = 100, name = "합성 자료.pdf") {
  const input = {
    fileId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    reservationId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    expiresAt: "2026-10-06T01:00:00.000Z",
    admission: admission(),
  };
  const result = await f.files.reserve(
    guard(f),
    {
      name,
      byteLength: bytes,
      mediaType: "application/pdf",
      autoProcessConsentVersion: "synthetic-v2",
    },
    input,
  );
  if (!result) throw new Error("Synthetic upload reservation did not succeed");
  expect(result.fileId).toBe(input.fileId);
  return { input, bytes, name };
}
type Reserved = Awaited<ReturnType<typeof reserve>>;
function blob(
  reservationId: string,
  bytes: number,
  overrides: Partial<BlobRegistration> = {},
): BlobRegistration {
  return {
    id: crypto.randomUUID(),
    reservationId,
    kind: "original",
    visibility: "private",
    logicalBytes: bytes,
    cipherBytes: bytes + 16,
    cipherHash: CIPHER_HASH,
    contentHash: HASH,
    keyVersion: "1",
    ...overrides,
  };
}
function uploaded(r: Reserved): V2File {
  const parts = Array.from({ length: Math.ceil(r.bytes / CHUNK) }, (_, index) => ({
    index,
    byteLength: Math.min(CHUNK, r.bytes - index * CHUNK),
    contentHash: HASH,
  }));
  return {
    schemaVersion: "2",
    id: r.input.fileId,
    revision: 2,
    name: r.name,
    declaredMediaType: "application/pdf",
    byteLength: r.bytes,
    status: "uploaded",
    probe: { category: "document", format: "pdf", byteLength: r.bytes, pageCount: 1 },
    manifest: { byteLength: r.bytes, contentHash: HASH, parts },
    coverage: null,
    observations: [],
    derivatives: [],
    currentJobId: null,
    operationId: r.input.admission.operationId,
    failure: null,
    createdAt: NOW,
  };
}
async function upload(f: Fixture, reserved?: Reserved) {
  const r = reserved ?? (await reserve(f));
  const value = uploaded(r);
  for (const part of value.manifest?.parts ?? []) {
    const b = blob(r.input.reservationId, part.byteLength);
    expect(await f.storage.registerBlob(f.actor, b)).toBe(true);
    expect(
      await f.files.recordPart(
        f.actor,
        r.input.uploadId,
        1,
        part.index,
        b.id,
        b.logicalBytes,
        b.cipherHash,
      ),
    ).toBe(true);
  }
  expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(true);
  expect(await f.storage.commitReservation(f.actor, r.input.reservationId)).toBe(true);
  expect(await f.files.finishUpload(guard(f), value)).toBe(true);
  return { r, value };
}
async function processing(f: Fixture, existing?: Awaited<ReturnType<typeof upload>>) {
  const u = existing ?? (await upload(f));
  const jobId = crypto.randomUUID();
  const input = admission();
  expect(
    await f.jobs.admitFile(guard(f), {
      fileId: u.value.id,
      fileRevision: 2,
      jobId,
      admission: input,
      quotas: [],
    }),
  ).toBe(true);
  const acquired = await f.jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    "2026-10-06T00:02:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic file job did not acquire");
  const current = await f.files.read(f.actor, u.value.id);
  if (!current) throw new Error("Synthetic processing file missing");
  return { ...u, input, lease: acquired.lease, current };
}
const coverage: V2Coverage = {
  category: "document",
  status: "complete",
  pageCount: 1,
  pages: [{ page: 1, status: "processed" }],
};
function observation(index = 0): V2FileObservation {
  return {
    id: `synthetic-observation-${index}`,
    text: `합성 관측 ${index} 😀`,
    position: { kind: "document", page: 1, paragraph: null, table: null },
    certainty: "observed",
    userEdited: false,
    included: true,
  };
}
function derivative(index = 0): V2Derivative {
  return {
    id: `synthetic-derivative-${index}`,
    kind: "extracted_text",
    byteLength: 1,
    contentHash: HASH,
    sourcePosition: { kind: "document", page: 1, paragraph: null, table: null },
  };
}
function ready(
  p: Awaited<ReturnType<typeof processing>>,
  observations: V2FileObservation[] = [],
  derivatives: V2Derivative[] = [],
): V2File {
  return {
    ...p.current,
    revision: 3,
    status: "ready",
    currentJobId: null,
    coverage,
    observations,
    derivatives,
  };
}
async function derivedBlob(
  f: Fixture,
  p: Awaited<ReturnType<typeof processing>>,
  value = derivative(),
) {
  const b = blob(crypto.randomUUID(), value.byteLength, { kind: "derivative" });
  expect(
    await f.storage.reserveArtifact(guard(f), {
      id: b.reservationId,
      artifactId: b.id,
      target: { kind: "file", id: p.current.id, revision: 2 },
      operationId: p.input.operationId,
      byteLength: b.logicalBytes,
    }),
  ).toBe(true);
  expect(await f.storage.registerBlob(f.actor, b)).toBe(true);
  return b;
}
async function coverageStage(f: Fixture, p: Awaited<ReturnType<typeof processing>>) {
  const id = crypto.randomUUID();
  const text = JSON.stringify(coverage);
  const parts = fragmentText(text);
  const g = guard(f);
  expect(
    await f.staging.begin(
      g,
      {
        id,
        purpose: "file_coverage",
        targetId: p.current.id,
        revision: 3,
        partCount: parts.length,
        byteLength: utf8Bytes(text),
      },
      p.lease,
    ),
  ).toBe(true);
  for (const [index, part] of parts.entries())
    expect(await f.staging.append(g, id, index, part, p.lease)).toBe(true);
  expect(
    await f.staging.seal(
      g,
      id,
      { schemaVersion: "2", purpose: "file_coverage", targetId: p.current.id, revision: 3 },
      p.lease,
    ),
  ).toBe(true);
  return { id, g };
}
function count(f: Fixture, table: string) {
  return (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

test("original receipts finalize a 255 Unicode scalar filename and processing preserves immutable manifest", async () => {
  const f = await fixture();
  const name = `${"가".repeat(124)}${"😀".repeat(127)}.pdf`;
  expect([...name].length).toBe(255);
  expect(name.length).toBeGreaterThan(255);
  const u = await upload(f, await reserve(f, 100, name));
  expect((await f.files.read(f.actor, u.value.id))?.name).toBe(name);
  const before = f.database.sqlite
    .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
    .get(u.value.id);
  const p = await processing(f, u);
  const d = derivative();
  const b = await derivedBlob(f, p, d);
  expect(
    await f.files.writeProcessed(guard(f), ready(p, [observation()], [d]), p.lease, {
      [d.id]: b.id,
    }),
  ).toBe(true);
  const actual = await f.files.read(f.actor, p.current.id);
  expect(actual?.name).toBe(name);
  expect(actual?.revision).toBe(3);
  expect(actual?.manifest).toEqual(u.value.manifest);
  expect(actual?.observations).toEqual([observation()]);
  expect(actual?.derivatives).toEqual([d]);
  expect(
    f.database.sqlite.query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?").get(u.value.id),
  ).toEqual(before);
  expect(await f.files.writeProcessed(guard(f), ready(p), p.lease, {})).toBe(false);
});

test("upload part receipts reject wrong file provenance, hash, bytes, ordinal, revision and owner", async () => {
  const f = await fixture();
  const r = await reserve(f);
  const second = await reserve(f);
  const b = blob(r.input.reservationId, 100);
  expect(await f.storage.registerBlob(f.actor, b)).toBe(true);
  expect(
    await f.files.recordPart(f.actor, second.input.uploadId, 1, 0, b.id, 100, CIPHER_HASH),
  ).toBe(false);
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 99, CIPHER_HASH)).toBe(
    false,
  );
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 100, "b".repeat(64))).toBe(
    false,
  );
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 1, b.id, 100, CIPHER_HASH)).toBe(
    false,
  );
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 2, 0, b.id, 100, CIPHER_HASH)).toBe(
    false,
  );
  const other = await seedTestSession(f.database, { consent: true });
  expect(
    await f.files.recordPart(
      { ownerId: other.userId, now: NOW },
      r.input.uploadId,
      1,
      0,
      b.id,
      100,
      CIPHER_HASH,
    ),
  ).toBe(false);
  expect(count(f, "v2_upload_parts")).toBe(0);
  expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(false);
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 100, CIPHER_HASH)).toBe(
    true,
  );
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 100, CIPHER_HASH)).toBe(
    false,
  );
});

test("whole digest and complete ordered part receipts are required before finalization", async () => {
  const f = await fixture();
  const r = await reserve(f, CHUNK + 7);
  const value = uploaded(r);
  const parts = value.manifest?.parts ?? [];
  const tail = blob(r.input.reservationId, 7);
  expect(await f.storage.registerBlob(f.actor, tail)).toBe(true);
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 1, tail.id, 7, CIPHER_HASH)).toBe(
    true,
  );
  expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(false);
  expect(await f.files.finishUpload(guard(f), value)).toBe(false);
  const head = blob(r.input.reservationId, CHUNK);
  expect(await f.storage.registerBlob(f.actor, head)).toBe(true);
  expect(
    await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, head.id, CHUNK, CIPHER_HASH),
  ).toBe(true);
  expect(await f.files.finishUpload(guard(f), value)).toBe(false);
  expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(true);
  const wrong = { ...value, manifest: { byteLength: r.bytes, contentHash: "b".repeat(64), parts } };
  expect(await f.files.finishUpload(guard(f), wrong)).toBe(false);
  const wrongPart = {
    ...value,
    manifest: {
      byteLength: r.bytes,
      contentHash: HASH,
      parts: parts.map((part) => ({ ...part, contentHash: "b".repeat(64) })),
    },
  };
  expect(await f.files.finishUpload(guard(f), wrongPart)).toBe(false);
  expect(await f.files.finishUpload(guard(f), value)).toBe(true);
  expect((await f.files.read(f.actor, value.id))?.manifest).toEqual(value.manifest);
});

test("changing a recorded blob key version or receipt blob identity prevents upload finalize", async () => {
  for (const mutation of ["key_version='another-key'", "blob_id=NULL"]) {
    const f = await fixture();
    const r = await reserve(f);
    const b = blob(r.input.reservationId, 100);
    expect(await f.storage.registerBlob(f.actor, b)).toBe(true);
    expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 100, CIPHER_HASH)).toBe(
      true,
    );
    expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(true);
    if (mutation.startsWith("key"))
      f.database.sqlite.query(`UPDATE v2_blobs SET ${mutation} WHERE id=?`).run(b.id);
    else {
      const otherFile = await reserve(f, 1);
      const other = blob(otherFile.input.reservationId, 1);
      expect(await f.storage.registerBlob(f.actor, other)).toBe(true);
      f.database.sqlite
        .query("UPDATE v2_upload_parts SET blob_id=? WHERE upload_id=?")
        .run(other.id, r.input.uploadId);
    }
    expect(await f.files.finishUpload(guard(f), uploaded(r))).toBe(false);
    expect((await f.files.read(f.actor, r.input.fileId))?.status).toBe("reserved");
  }
});

test("processed publication rejects a different original, stale job fence, revision and derivative provenance", async () => {
  const f = await fixture();
  const p = await processing(f);
  const other = await processing(f);
  const d = derivative();
  const foreignBlob = await derivedBlob(f, other, d);
  const value = ready(p, [observation()], [d]);
  await expect(
    f.files.writeProcessed(guard(f), value, p.lease, { [d.id]: foreignBlob.id }),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect((await f.files.read(f.actor, p.current.id))?.status).toBe("queued");
  if (!p.current.manifest) throw new Error("Synthetic original required");
  const changedOriginal = {
    ...ready(p),
    manifest: { ...p.current.manifest, contentHash: "b".repeat(64) },
  };
  expect(await f.files.writeProcessed(guard(f), changedOriginal, p.lease, {})).toBe(false);
  expect(
    await f.files.writeProcessed(
      guard(f),
      ready(p),
      { ...p.lease, fencing: p.lease.fencing + 1 },
      {},
    ),
  ).toBe(false);
  expect(await f.files.writeProcessed(guard(f), { ...ready(p), revision: 2 }, p.lease, {})).toBe(
    false,
  );
  expect(await f.files.writeProcessed(guard(f), ready(p), other.lease, {})).toBe(false);
});

test("SQL failure rolls processed publication back and the same valid lease can retry", async () => {
  const f = await fixture();
  const p = await processing(f);
  const snapshots = count(f, "v2_private_snapshots");
  const revision = guard(f).expectedRevision;
  f.database.sqlite.exec(
    "CREATE TRIGGER synthetic_fail_file_ready BEFORE UPDATE OF state ON v2_files WHEN NEW.state='ready' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(
    f.files.writeProcessed(guard(f), ready(p, [observation()]), p.lease, {}),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(count(f, "v2_private_snapshots")).toBe(snapshots);
  expect(count(f, "v2_file_observations")).toBe(0);
  expect(count(f, "v2_mutation_claims")).toBe(0);
  expect(guard(f).expectedRevision).toBe(revision);
  expect((await f.jobs.find(f.actor, p.lease.jobId))?.status).toBe("running");
  f.database.sqlite.exec("DROP TRIGGER synthetic_fail_file_ready");
  expect(await f.files.writeProcessed(guard(f), ready(p, [observation()]), p.lease, {})).toBe(true);
});

test("file deletion blocks private reads and a late physical blob stays charged until cleanup receipt", async () => {
  const f = await fixture();
  const r = await reserve(f);
  const b = blob(r.input.reservationId, 100);
  f.database.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(r.input.fileId, NOW);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let reads = 0;
  f.core.cipher.decrypt = async (e, c) => {
    reads++;
    return decrypt(e, c);
  };
  expect(await f.files.read(f.actor, r.input.fileId)).toBeNull();
  expect(reads).toBe(0);
  expect(await f.storage.registerBlob(f.actor, b)).toBe(false);
  expect(await f.storage.recordLateBlobForCleanup(b, NOW)).toBe(true);
  expect(await f.storage.recordLateBlobForCleanup(b, NOW)).toBe(false);
  expect(await f.storage.findBlob(f.actor, b.id)).toBeNull();
  const usage = () => f.database.sqlite.query("SELECT stored_bytes FROM v2_storage_usage").get();
  expect(usage()).toEqual({ stored_bytes: 100 });
  expect(await f.storage.confirmBlobDeleted(b.id, NOW)).toBe(false);
  const deletion = createV2DeletionRepository(f.core);
  const journal = await deletion.findByTarget("blob", b.id);
  if (!journal) throw new Error("Synthetic late blob cleanup journal missing");
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:02:00.000Z",
  );
  if (!lease) throw new Error("Synthetic late blob cleanup lease missing");
  const receipt = {
    lease,
    receiptId: crypto.randomUUID(),
    objectKey: `private/${b.id}`,
    cipherHash: CIPHER_HASH,
  };
  expect(
    await f.storage.confirmBlobDeleted(b.id, NOW, {
      ...receipt,
      objectKey: "private/another-object",
    }),
  ).toBe(false);
  expect(
    await f.storage.confirmBlobDeleted(b.id, NOW, { ...receipt, cipherHash: "b".repeat(64) }),
  ).toBe(false);
  expect(usage()).toEqual({ stored_bytes: 100 });
  expect(await f.storage.confirmBlobDeleted(b.id, NOW, receipt)).toBe(true);
  expect(await f.storage.confirmBlobDeleted(b.id, NOW)).toBe(false);
  expect(usage()).toEqual({ stored_bytes: 0 });
});

test("changing stored original content after its part receipt cannot finalize the old digest", async () => {
  const f = await fixture();
  const r = await reserve(f);
  const b = blob(r.input.reservationId, 100);
  expect(await f.storage.registerBlob(f.actor, b)).toBe(true);
  expect(await f.files.recordPart(f.actor, r.input.uploadId, 1, 0, b.id, 100, CIPHER_HASH)).toBe(
    true,
  );
  expect(await f.files.recordOriginalDigest(f.actor, r.input.uploadId, 1, HASH)).toBe(true);
  const changed = await f.core.encrypt("v2_blobs", b.id, f.actor.ownerId, 1, {
    contentHash: "b".repeat(64),
  });
  f.database.sqlite.query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?").run(changed, b.id);
  expect(await f.files.finishUpload(guard(f), uploaded(r))).toBe(false);
  expect((await f.files.read(f.actor, r.input.fileId))?.status).toBe("reserved");
});

test("small processed publication must still bind the current job pointer and processing state", async () => {
  for (const mutation of ["current_job_id=NULL", "state='failed',failure_code='INTERNAL_ERROR'"]) {
    const f = await fixture();
    const p = await processing(f);
    f.database.sqlite.query(`UPDATE v2_files SET ${mutation} WHERE id=?`).run(p.current.id);
    expect(await f.files.writeProcessed(guard(f), ready(p), p.lease, {})).toBe(false);
    expect((await f.jobs.find(f.actor, p.lease.jobId))?.status).toBe("running");
  }
});

test("staged pages preserve exact values, replay safely and cannot publish missing ordinals", async () => {
  const f = await fixture();
  const p = await processing(f);
  const d = derivative();
  const b = await derivedBlob(f, p, d);
  const s = await coverageStage(f, p);
  const page = {
    fileId: p.current.id,
    fileRevision: 2,
    coverageSnapshotId: s.id,
    observationOrdinal: 1,
    observations: [observation(1)],
    derivativeOrdinal: 0,
    derivatives: [{ value: d, blobId: b.id }],
  };
  expect(await f.fileStaging.stagePage(s.g, page, p.lease)).toBe(true);
  expect(await f.fileStaging.stagePage(s.g, page, p.lease)).toBe(true);
  expect(await f.fileStaging.observations(f.actor, p.current.id)).toEqual([]);
  expect(
    await f.fileStaging.publish(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationCount: 1,
        derivativeCount: 1,
      },
      p.lease,
    ),
  ).toBe(false);
});

test("staged observations require globally unique IDs across bounded pages", async () => {
  const f = await fixture();
  const p = await processing(f);
  const s = await coverageStage(f, p);
  const value = observation();
  expect(
    await f.fileStaging.stagePage(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationOrdinal: 0,
        observations: [value],
        derivativeOrdinal: 0,
        derivatives: [],
      },
      p.lease,
    ),
  ).toBe(true);
  await expect(
    f.fileStaging.stagePage(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationOrdinal: 1,
        observations: [value],
        derivativeOrdinal: 0,
        derivatives: [],
      },
      p.lease,
    ),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(count(f, "v2_file_observations")).toBe(1);
});

test("100 originals, 5GB per case and 10GB per account admit exactly the final remaining unit", async () => {
  for (const boundary of ["count", "caseBytes", "accountBytes"]) {
    const f = await fixture();
    if (boundary === "count")
      f.database.sqlite
        .query("UPDATE v2_case_original_usage SET stored_count=99 WHERE workspace_id=?")
        .run(f.workspaceId);
    if (boundary === "caseBytes")
      f.database.sqlite
        .query("UPDATE v2_case_original_usage SET stored_bytes=4999999999 WHERE workspace_id=?")
        .run(f.workspaceId);
    if (boundary === "accountBytes")
      f.database.sqlite.query("UPDATE v2_storage_usage SET stored_bytes=9999999999").run();
    await reserve(f, 1);
    const operations = count(f, "v2_operations");
    const files = count(f, "v2_files");
    const rejected = await f.files.reserve(
      guard(f),
      {
        name: "한도 초과 합성 파일.pdf",
        byteLength: 1,
        mediaType: "application/pdf",
        autoProcessConsentVersion: "synthetic-v2",
      },
      {
        fileId: crypto.randomUUID(),
        uploadId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        consentId: crypto.randomUUID(),
        expiresAt: "2026-10-06T01:00:00.000Z",
        admission: admission(),
      },
    );
    expect(rejected).toBeNull();
    expect(count(f, "v2_operations")).toBe(operations);
    expect(count(f, "v2_files")).toBe(files);
    expect(count(f, "v2_mutation_claims")).toBe(0);
  }
});

test("actual reservations reach 100 files and two 5GB workspaces share the 10GB account cap", async () => {
  const f = await fixture();
  for (let index = 0; index < 100; index++) await reserve(f, 1, `합성 파일 ${index}.pdf`);
  expect((await f.storage.caseUsage(f.actor, f.workspaceId))?.count).toEqual({
    limit: 100,
    used: 0,
    reserved: 100,
    remaining: 0,
  });
  const reject = async (target: Fixture) =>
    target.files.reserve(
      guard(target),
      {
        name: "한도 이후 합성 파일.pdf",
        byteLength: 1,
        mediaType: "application/pdf",
        autoProcessConsentVersion: "synthetic-v2",
      },
      {
        fileId: crypto.randomUUID(),
        uploadId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        consentId: crypto.randomUUID(),
        expiresAt: "2026-10-06T01:00:00.000Z",
        admission: admission(),
      },
    );
  expect(await reject(f)).toBeNull();
  expect(count(f, "v2_files")).toBe(100);
  const separate = await fixture();
  for (let index = 0; index < 5; index++) await reserve(separate, 1_000_000_000);
  expect(
    (await separate.storage.caseUsage(separate.actor, separate.workspaceId))?.originalBytes,
  ).toEqual({ limit: 5_000_000_000, used: 0, reserved: 5_000_000_000, remaining: 0 });
  expect(await reject(separate)).toBeNull();
  const extra = async () => {
    const workspaceId = crypto.randomUUID();
    const envelope = await separate.core.encrypt(
      "v2_workspaces",
      workspaceId,
      separate.actor.ownerId,
      1,
      { subjectContext: "individual", jurisdiction: "KR" },
    );
    separate.database.sqlite
      .query(
        "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
      )
      .run(workspaceId, separate.actor.ownerId, envelope, NOW, NOW);
    separate.database.sqlite
      .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
      .run(workspaceId);
    return { ...separate, workspaceId };
  };
  const second = await extra();
  for (let index = 0; index < 5; index++) await reserve(second, 1_000_000_000);
  expect(
    separate.database.sqlite
      .query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage")
      .get(),
  ).toEqual({ stored_bytes: 0, reserved_bytes: 10_000_000_000 });
  const third = await extra();
  expect(await reject(third)).toBeNull();
  expect((await third.storage.caseUsage(third.actor, third.workspaceId))?.count.reserved).toBe(0);
});

test("failed processing retries the same file operation and stale lease cannot publish", async () => {
  const f = await fixture();
  const p = await processing(f);
  expect(await f.jobs.fail(f.actor, p.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  expect(await f.jobs.retry(guard(f), p.lease.jobId)).toBe(true);
  const retried = await f.jobs.acquire(
    f.actor,
    p.lease.jobId,
    crypto.randomUUID(),
    "2026-10-06T00:02:00.000Z",
  );
  if (!retried) throw new Error("Synthetic retry did not acquire");
  expect(retried.job.operationId).toBe(p.input.operationId);
  expect(retried.lease.fencing).toBeGreaterThan(p.lease.fencing);
  expect(await f.files.writeProcessed(guard(f), ready(p), p.lease, {})).toBe(false);
  expect(await f.files.writeProcessed(guard(f), ready(p), retried.lease, {})).toBe(true);
});

test("file tombstone during paged observation decryption prevents returning private values", async () => {
  const f = await fixture();
  const p = await processing(f);
  const s = await coverageStage(f, p);
  expect(
    await f.fileStaging.stagePage(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationOrdinal: 0,
        observations: [observation()],
        derivativeOrdinal: 0,
        derivatives: [],
      },
      p.lease,
    ),
  ).toBe(true);
  expect(
    await f.fileStaging.publish(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationCount: 1,
        derivativeCount: 0,
      },
      p.lease,
    ),
  ).toBe(true);
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  let deleted = false;
  f.core.cipher.decrypt = async (e, c) => {
    const text = await decrypt(e, c);
    if (c.table === "v2_file_observations" && !deleted) {
      deleted = true;
      f.database.sqlite
        .query("INSERT INTO v2_tombstones VALUES('file',?,?)")
        .run(p.current.id, NOW);
    }
    return text;
  };
  expect(await f.fileStaging.observations(f.actor, p.current.id)).toEqual([]);
  expect(deleted).toBe(true);
  expect(await f.fileStaging.derivatives(f.actor, p.current.id)).toEqual([]);
});

// Upstream object-store storage is synthetic; admission records and encrypted receipts are real.
async function storedDerivativeFixture(
  f: Fixture,
  p: Awaited<ReturnType<typeof processing>>,
  value: V2Derivative,
) {
  const b = blob(crypto.randomUUID(), value.byteLength, { kind: "derivative" });
  const claimId = crypto.randomUUID();
  const accepted = await f.core.changed([
    f.core.claim(guard(f), claimId),
    ...storageReservationStatements(
      f.core,
      f.actor,
      {
        id: b.reservationId,
        kind: "derived_or_report",
        caseId: f.workspaceId,
        operationId: p.input.operationId,
        byteLength: b.logicalBytes,
        state: "reserved",
      },
      p.input.operationId,
      claimId,
      b.id,
      p.current.id,
    ),
    f.core.finish(claimId),
  ]);
  if (!accepted || !(await f.storage.registerBlob(f.actor, b)))
    throw new Error("Synthetic stored derivative fixture failed");
  return b;
}

test("10000 observations and 20000 derivatives publish and paginate losslessly through bounded pages", async () => {
  const f = await fixture();
  const p = await processing(f);
  const s = await coverageStage(f, p);
  for (let ordinal = 0; ordinal < 20_000; ordinal += 4) {
    const observations: V2FileObservation[] =
      ordinal < 10_000
        ? Array.from({ length: 4 }, (_, offset) => ({
            ...observation(ordinal + offset),
            text: ordinal === 0 ? "😀".repeat(5000) : `합성 관측 ${ordinal + offset} 😀`,
          }))
        : [];
    const derivatives: { value: V2Derivative; blobId: string }[] = [];
    for (let offset = 0; offset < 4; offset++) {
      const value = derivative(ordinal + offset);
      const b = await storedDerivativeFixture(f, p, value);
      derivatives.push({ value, blobId: b.id });
    }
    expect(
      await f.fileStaging.stagePage(
        s.g,
        {
          fileId: p.current.id,
          fileRevision: 2,
          coverageSnapshotId: s.id,
          observationOrdinal: Math.min(ordinal, 10_000),
          observations,
          derivativeOrdinal: ordinal,
          derivatives,
        },
        p.lease,
      ),
    ).toBe(true);
  }
  expect(count(f, "v2_file_observations")).toBe(10_000);
  expect(count(f, "v2_file_derivatives")).toBe(20_000);
  expect(
    await f.fileStaging.publish(
      s.g,
      {
        fileId: p.current.id,
        fileRevision: 2,
        coverageSnapshotId: s.id,
        observationCount: 10_000,
        derivativeCount: 20_000,
      },
      p.lease,
    ),
  ).toBe(true);
  await expect(f.files.read(f.actor, p.current.id)).rejects.toThrow("SNAPSHOT_STREAM_REQUIRED");
  let observationCount = 0;
  let after = -1;
  while (true) {
    const page = await f.fileStaging.observations(f.actor, p.current.id, after, 4);
    if (!page.length) break;
    for (const entry of page) {
      expect(entry.ordinal).toBe(observationCount);
      expect(entry.value).toEqual({
        ...observation(observationCount),
        text: observationCount < 4 ? "😀".repeat(5000) : `합성 관측 ${observationCount} 😀`,
      });
      observationCount++;
    }
    after = observationCount - 1;
  }
  expect(observationCount).toBe(10_000);
  let derivativeCount = 0;
  after = -1;
  while (true) {
    const page = await f.fileStaging.derivatives(f.actor, p.current.id, after, 4);
    if (!page.length) break;
    for (const entry of page) {
      expect(entry.ordinal).toBe(derivativeCount);
      expect(entry.value).toEqual(derivative(derivativeCount));
      derivativeCount++;
    }
    after = derivativeCount - 1;
  }
  expect(derivativeCount).toBe(20_000);
  expect(await f.fileStaging.derivatives(f.actor, p.current.id, 19_999, 4)).toEqual([]);
}, 180_000);
