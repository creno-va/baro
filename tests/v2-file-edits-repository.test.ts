import { afterEach, expect, test } from "bun:test";
import type { V2Coverage, V2Derivative, V2File, V2FileObservation } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { type Actor, createV2Core, utf8Bytes } from "../src/server/db/v2-core";
import { createV2FileEditsRepository } from "../src/server/db/v2-file-edits";
import { createV2FileStagingRepository } from "../src/server/db/v2-file-staging";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { type BlobRegistration, createV2StorageRepository } from "../src/server/db/v2-storage";
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
    edits: createV2FileEditsRepository(core),
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
      quotas:
        u.value.probe && "durationSeconds" in u.value.probe
          ? [{ kind: "media_processing", originalDurationSeconds: u.value.probe.durationSeconds }]
          : [],
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
function count(f: Fixture, table: string) {
  return (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

async function sourceFixture(observations = 7, derivatives = 5, multiPart = false) {
  const f = await fixture();
  const name = `${"가".repeat(124)}${"😀".repeat(127)}.pdf`;
  const p = await processing(f, await upload(f, await reserve(f, 100, name)));
  const selected = Array.from({ length: derivatives }, (_, i) => derivative(i));
  const blobMap: Record<string, string> = {};
  for (const d of selected) blobMap[d.id] = (await derivedBlob(f, p, d)).id;
  const value = ready(
    p,
    Array.from({ length: observations }, (_, i) => observation(i)),
    selected,
  );
  if (multiPart) {
    value.probe = { category: "document", format: "docx", byteLength: 100, pageCount: 2000 };
    value.coverage = {
      category: "document",
      status: "complete",
      pageCount: 2000,
      pages: Array.from({ length: 2000 }, (_, i) => ({
        page: i + 1,
        status: "processed" as const,
      })),
    };
  }
  expect(await f.files.writeProcessed(guard(f), value, p.lease, blobMap)).toBe(true);
  return { ...f, fileId: value.id, value, blobMap };
}
type SourceFixture = Awaited<ReturnType<typeof sourceFixture>>;
function row(f: SourceFixture) {
  return f.database.sqlite.query("SELECT * FROM v2_files WHERE id=?").get(f.fileId) as {
    revision: number;
    manifest_snapshot_id: string;
    coverage_snapshot_id: string;
    encrypted_payload: string;
  };
}
async function begin(f: SourceFixture) {
  const g = guard(f);
  const input = {
    id: crypto.randomUUID(),
    fileId: f.fileId,
    coverageSnapshotId: crypto.randomUUID(),
    expiresAt: "2026-10-06T00:30:00.000Z",
    request: {
      expectedRevision: 3,
      edits: [
        { observationId: observation().id, text: "사용자가 확인한 수정 😀", included: false },
      ],
    },
  };
  expect(await f.edits.begin(g, input)).toBe(true);
  const edit = input.request.edits[0];
  if (!edit) throw new Error("Synthetic edit request is missing its required edit");
  return { g, input, edit };
}
async function copyAll(
  f: SourceFixture,
  stage: Awaited<ReturnType<typeof begin>>,
  observations = 7,
  derivatives = 5,
) {
  const parts = f.database.sqlite
    .query("SELECT part_count FROM v2_private_snapshots WHERE id=?")
    .get(row(f).coverage_snapshot_id) as { part_count: number };
  for (let i = 0; i < parts.part_count; i++)
    expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, i)).toBe(true);
  for (let i = 0; i < Math.max(observations, derivatives); i += 4)
    expect(
      await f.edits.copyPage(stage.g, stage.input.id, {
        observationOrdinal: Math.min(i, observations),
        derivativeOrdinal: Math.min(i, derivatives),
      }),
    ).toBe(true);
}

test("bounded edit preserves original pointer, coverage, untouched metadata and flags only edited observation", async () => {
  const f = await sourceFixture(7, 5, true);
  const original = row(f);
  const quota = f.database.sqlite.query("SELECT * FROM v2_quota_reservations").all();
  const stage = await begin(f);
  expect(await f.edits.begin(stage.g, stage.input)).toBe(true);
  expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, 1)).toBe(false);
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
  await copyAll(f, stage);
  expect(row(f)).toEqual(original);
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(true);
  expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, 0)).toBe(true);
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(true);
  const actual = await f.files.read(f.actor, f.fileId);
  expect(actual?.revision).toBe(4);
  expect(actual?.coverage).toEqual(f.value.coverage);
  expect(actual?.manifest).toEqual(f.value.manifest);
  expect(actual?.observations[0]).toEqual({
    ...observation(),
    text: stage.edit.text,
    included: false,
    userEdited: true,
    certainty: "uncertain",
  });
  expect(actual?.observations.slice(1)).toEqual(f.value.observations.slice(1));
  expect(actual?.derivatives).toEqual(f.value.derivatives);
  expect(row(f).manifest_snapshot_id).toBe(original.manifest_snapshot_id);
  expect(row(f).coverage_snapshot_id).toBe(stage.input.coverageSnapshotId);
  expect(count(f, "v2_file_edit_stages")).toBe(0);
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(f.database.sqlite.query("SELECT * FROM v2_quota_reservations").all()).toEqual(quota);
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
});

test("ownership, state, revision, TTL, missing edits and exact expiry fail closed before private decryption", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  const other = await seedTestSession(f.database, { consent: true });
  let calls = 0;
  const decrypt = f.core.cipher.decrypt.bind(f.core.cipher);
  f.core.cipher.decrypt = async (e, c) => {
    calls++;
    return decrypt(e, c);
  };
  const foreign = { ...stage.g, ownerId: other.userId };
  expect(
    await f.edits.copyPage(foreign, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(false);
  expect(await f.edits.copyCoveragePart(foreign, stage.input.id, 0)).toBe(false);
  expect(await f.edits.publish(foreign, stage.input.id)).toBe(false);
  expect(await f.edits.abandon(foreign, stage.input.id)).toBe(false);
  expect(
    await f.edits.copyPage(
      { ...stage.g, expectedRevision: stage.g.expectedRevision + 1 },
      stage.input.id,
      { observationOrdinal: 0, derivativeOrdinal: 0 },
    ),
  ).toBe(false);
  expect(
    await f.edits.copyCoveragePart({ ...stage.g, now: stage.input.expiresAt }, stage.input.id, 0),
  ).toBe(false);
  expect(calls).toBe(0);
  expect(
    await f.edits.begin(stage.g, {
      ...stage.input,
      id: crypto.randomUUID(),
      expiresAt: "2026-10-06T00:30:00.001Z",
    }),
  ).toBe(false);
  expect(
    await f.edits.begin(stage.g, {
      ...stage.input,
      id: crypto.randomUUID(),
      request: { expectedRevision: 2, edits: stage.input.request.edits },
    }),
  ).toBe(false);
  expect(
    await f.edits.begin(stage.g, {
      ...stage.input,
      id: crypto.randomUUID(),
      request: {
        expectedRevision: 3,
        edits: [{ observationId: "missing", text: "missing", included: true }],
      },
    }),
  ).toBe(false);
  f.database.sqlite.query("UPDATE v2_files SET state='uploaded' WHERE id=?").run(f.fileId);
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(false);
  f.database.sqlite.query("UPDATE v2_files SET state='ready' WHERE id=?").run(f.fileId);
  expect(await f.edits.abandon({ ...stage.g, now: stage.input.expiresAt }, stage.input.id)).toBe(
    true,
  );
  expect(count(f, "v2_file_edit_stages")).toBe(0);
});

test("crash replay and expired abandon remove every staged row without deleting source", async () => {
  const f = await sourceFixture();
  const original = row(f);
  const stage = await begin(f);
  expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, 0)).toBe(true);
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(true);
  const restarted = createV2FileEditsRepository(f.core);
  expect(
    await restarted.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(true);
  expect(count(f, "v2_file_edit_receipts")).toBe(9);
  expect(await restarted.abandon({ ...stage.g, now: stage.input.expiresAt }, stage.input.id)).toBe(
    true,
  );
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_file_observations WHERE file_revision=4")
      .get(),
  ).toEqual({ n: 0 });
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_file_derivatives WHERE file_revision=4")
      .get(),
  ).toEqual({ n: 0 });
  expect(row(f)).toEqual(original);
  expect((await f.files.read(f.actor, f.fileId))?.observations).toEqual(f.value.observations);
});

test("deletion during encryption prevents writes and publication", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  const encrypt = f.core.cipher.encrypt.bind(f.core.cipher);
  let deleted = false;
  f.core.cipher.encrypt = async (text, context) => {
    const result = await encrypt(text, context);
    if (context.table === "v2_file_observations" && !deleted) {
      deleted = true;
      f.database.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(f.fileId, NOW);
    }
    return result;
  };
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(false);
  expect(deleted).toBe(true);
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_file_observations WHERE file_revision=4")
      .get(),
  ).toEqual({ n: 0 });
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
  expect(await f.files.read(f.actor, f.fileId)).toBeNull();
});

test("source change during encryption rolls back the page and stale job pointers block editing", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  const encrypt = f.core.cipher.encrypt.bind(f.core.cipher);
  let changed = false;
  f.core.cipher.encrypt = async (text, context) => {
    const result = await encrypt(text, context);
    if (context.table === "v2_file_observations" && !changed) {
      changed = true;
      f.database.sqlite
        .query("UPDATE v2_files SET encrypted_payload='new source' WHERE id=?")
        .run(f.fileId);
    }
    return result;
  };
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(false);
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_file_observations WHERE file_revision=4")
      .get(),
  ).toEqual({ n: 0 });
  expect(await f.edits.begin(stage.g, stage.input)).toBe(false);
  const job = f.database.sqlite.query("SELECT id FROM v2_jobs LIMIT 1").get() as { id: string };
  f.database.sqlite
    .query("UPDATE v2_files SET state='processing',current_job_id=? WHERE id=?")
    .run(job.id, f.fileId);
  expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, 0)).toBe(false);
  expect(await f.edits.abandon(stage.g, stage.input.id)).toBe(true);
});

test("a second editor cannot create orphan coverage or overwrite the first stage", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  const snapshots = count(f, "v2_private_snapshots");
  expect(
    await f.edits.begin(stage.g, {
      ...stage.input,
      id: crypto.randomUUID(),
      coverageSnapshotId: crypto.randomUUID(),
    }),
  ).toBe(false);
  expect(count(f, "v2_file_edit_stages")).toBe(1);
  expect(count(f, "v2_private_snapshots")).toBe(snapshots);
  await copyAll(f, stage);
  f.database.sqlite
    .query("INSERT INTO v2_tombstones VALUES('workspace',?,?)")
    .run(f.workspaceId, NOW);
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
  expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, 0)).toBe(false);
  expect(row(f).revision).toBe(3);
});

test("copy page SQL failure is atomic and the same stage can retry", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  f.database.sqlite.exec(
    "CREATE TRIGGER reject_edit_row BEFORE INSERT ON v2_file_derivatives WHEN NEW.file_revision=4 BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(
    f.edits.copyPage(stage.g, stage.input.id, { observationOrdinal: 0, derivativeOrdinal: 0 }),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_file_observations WHERE file_revision=4")
      .get(),
  ).toEqual({ n: 0 });
  f.database.sqlite.exec("DROP TRIGGER reject_edit_row");
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(true);
});

test("actual file deletion cascades edit stage, receipts, target snapshot and copied rows", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  await copyAll(f, stage);
  f.database.sqlite.query("DELETE FROM v2_files WHERE id=?").run(f.fileId);
  expect(count(f, "v2_file_edit_stages")).toBe(0);
  expect(count(f, "v2_file_edit_receipts")).toBe(0);
  expect(count(f, "v2_file_observations")).toBe(0);
  expect(count(f, "v2_file_derivatives")).toBe(0);
  expect(
    f.database.sqlite
      .query("SELECT count(*) n FROM v2_private_snapshots WHERE target_id=?")
      .get(f.fileId),
  ).toEqual({ n: 0 });
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
  expect(
    await f.edits.copyPage(stage.g, stage.input.id, {
      observationOrdinal: 0,
      derivativeOrdinal: 0,
    }),
  ).toBe(false);
});

for (const mutation of [
  "hash",
  "key",
  "bytes",
  "receipt",
  "manifest-part",
  "original-part",
] as const) {
  test(`original ${mutation} change cannot publish an otherwise complete edit`, async () => {
    const f = await sourceFixture();
    const stage = await begin(f);
    await copyAll(f, stage);
    const source = row(f);
    const part = f.database.sqlite.query("SELECT * FROM v2_upload_parts LIMIT 1").get() as {
      blob_id: string;
      upload_id: string;
      ordinal: number;
    };
    if (mutation === "hash") {
      const encrypted = await f.core.encrypt("v2_blobs", part.blob_id, f.actor.ownerId, 1, {
        contentHash: "b".repeat(64),
      });
      f.database.sqlite
        .query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?")
        .run(encrypted, part.blob_id);
    }
    if (mutation === "key")
      f.database.sqlite
        .query("UPDATE v2_blobs SET key_version='other' WHERE id=?")
        .run(part.blob_id);
    if (mutation === "bytes")
      f.database.sqlite.query("UPDATE v2_blobs SET logical_bytes=99 WHERE id=?").run(part.blob_id);
    if (mutation === "receipt")
      f.database.sqlite
        .query(
          "UPDATE v2_upload_parts SET encrypted_payload='changed' WHERE upload_id=? AND ordinal=?",
        )
        .run(part.upload_id, part.ordinal);
    if (mutation === "manifest-part")
      f.database.sqlite
        .query("DELETE FROM v2_private_parts WHERE snapshot_id=?")
        .run(source.manifest_snapshot_id);
    if (mutation === "original-part")
      f.database.sqlite.query("DELETE FROM v2_upload_parts WHERE upload_id=?").run(part.upload_id);
    expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
    expect(row(f).revision).toBe(3);
    expect(row(f).manifest_snapshot_id).toBe(source.manifest_snapshot_id);
  });
}

test("120 original chunk receipts and a 1GB original retain every hash and pointer through editing", async () => {
  const f = await fixture();
  const reserved = await reserve(f, 1_000_000_000, `${"😀".repeat(251)}.wav`);
  const uploadedValue = uploaded(reserved);
  uploadedValue.probe = {
    category: "audio",
    format: "wav",
    byteLength: reserved.bytes,
    durationSeconds: 1,
  };
  expect(uploadedValue.manifest?.parts.length).toBe(120);
  for (const part of uploadedValue.manifest?.parts ?? []) {
    const original = blob(reserved.input.reservationId, part.byteLength);
    expect(await f.storage.registerBlob(f.actor, original)).toBe(true);
    expect(
      await f.files.recordPart(
        f.actor,
        reserved.input.uploadId,
        1,
        part.index,
        original.id,
        original.logicalBytes,
        original.cipherHash,
      ),
    ).toBe(true);
  }
  expect(await f.files.recordOriginalDigest(f.actor, reserved.input.uploadId, 1, HASH)).toBe(true);
  expect(await f.storage.commitReservation(f.actor, reserved.input.reservationId)).toBe(true);
  expect(await f.files.finishUpload(guard(f), uploadedValue)).toBe(true);
  const p = await processing(f, { r: reserved, value: uploadedValue });
  const value: V2File = {
    ...p.current,
    revision: 3,
    status: "ready",
    currentJobId: null,
    coverage: {
      category: "audio",
      audio: {
        durationSeconds: 1,
        status: "complete",
        intervals: [{ startSeconds: 0, endSeconds: 1, status: "silent" }],
      },
    },
    observations: [
      { ...observation(), position: { kind: "audio", startSeconds: 0, endSeconds: 1 } },
    ],
  };
  expect(await f.files.writeProcessed(guard(f), value, p.lease, {})).toBe(true);
  const source = { ...f, fileId: value.id, value, blobMap: {} };
  const original = row(source);
  const stage = await begin(source);
  await copyAll(source, stage, 1, 0);
  expect(await source.edits.publish(stage.g, stage.input.id)).toBe(true);
  const actual = await source.files.read(source.actor, source.fileId);
  expect(actual?.manifest).toEqual(uploadedValue.manifest);
  expect(actual?.name).toBe(reserved.name);
  expect([...reserved.name].length).toBe(255);
  expect(actual?.byteLength).toBe(1_000_000_000);
  expect(row(source).manifest_snapshot_id).toBe(original.manifest_snapshot_id);
  expect(source.database.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({
    n: 120,
  });
});

for (const mutation of [
  "counts",
  "expiry",
  "target-owner",
  "target-purpose",
  "target-observation-revision",
  "source-operation",
] as const) {
  test(`encrypted stage and target scope reject changed ${mutation}`, async () => {
    const f = await sourceFixture();
    const stage = await begin(f);
    await copyAll(f, stage);
    if (mutation === "counts")
      f.database.sqlite
        .query("UPDATE v2_file_edit_stages SET observation_count=8 WHERE id=?")
        .run(stage.input.id);
    if (mutation === "expiry")
      f.database.sqlite
        .query("UPDATE v2_file_edit_stages SET expires_at='2026-10-06T00:31:00.000Z' WHERE id=?")
        .run(stage.input.id);
    if (mutation === "target-owner") {
      const other = await seedTestSession(f.database, { consent: true });
      f.database.sqlite
        .query("UPDATE v2_private_snapshots SET owner_id=? WHERE id=?")
        .run(other.userId, stage.input.coverageSnapshotId);
    }
    if (mutation === "target-purpose")
      f.database.sqlite
        .query("UPDATE v2_private_snapshots SET purpose='summary' WHERE id=?")
        .run(stage.input.coverageSnapshotId);
    if (mutation === "target-observation-revision")
      f.database.sqlite
        .query(
          "UPDATE v2_file_observations SET revision=3 WHERE file_id=? AND file_revision=4 AND ordinal=6",
        )
        .run(f.fileId);
    if (mutation === "source-operation") {
      const original = f.database.sqlite
        .query("SELECT operation_id FROM v2_storage_reservations LIMIT 1")
        .get() as { operation_id: string };
      f.database.sqlite
        .query("UPDATE v2_files SET operation_id=? WHERE id=?")
        .run(original.operation_id, f.fileId);
    }
    expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
    expect(row(f).revision).toBe(3);
  });
}

for (const change of [
  "file",
  "coverage",
  "manifest",
  "observation",
  "derivative",
  "target",
  "blob",
  "ordinal",
  "source-count",
] as const) {
  test(`final CAS rejects changed ${change} after every page was copied`, async () => {
    const f = await sourceFixture();
    const stage = await begin(f);
    await copyAll(f, stage);
    const before = row(f);
    if (change === "file")
      f.database.sqlite
        .query("UPDATE v2_files SET encrypted_payload='changed' WHERE id=?")
        .run(f.fileId);
    if (change === "coverage")
      f.database.sqlite
        .query("UPDATE v2_private_snapshots SET state='abandoned' WHERE id=?")
        .run(before.coverage_snapshot_id);
    if (change === "manifest")
      f.database.sqlite
        .query("UPDATE v2_private_snapshots SET state='abandoned' WHERE id=?")
        .run(before.manifest_snapshot_id);
    if (change === "observation")
      f.database.sqlite
        .query(
          "UPDATE v2_file_observations SET encrypted_payload='changed' WHERE file_id=? AND file_revision=3 AND ordinal=6",
        )
        .run(f.fileId);
    if (change === "derivative")
      f.database.sqlite
        .query(
          "UPDATE v2_file_derivatives SET encrypted_payload='changed' WHERE file_id=? AND file_revision=3 AND ordinal=4",
        )
        .run(f.fileId);
    if (change === "target")
      f.database.sqlite
        .query(
          "UPDATE v2_file_observations SET encrypted_payload='changed' WHERE file_id=? AND file_revision=4 AND ordinal=6",
        )
        .run(f.fileId);
    if (change === "blob")
      f.database.sqlite
        .query("UPDATE v2_blobs SET state='deleting' WHERE id=?")
        .run(f.blobMap[derivative(4).id] ?? "");
    if (change === "ordinal")
      f.database.sqlite
        .query(
          "UPDATE v2_file_observations SET ordinal=100 WHERE file_id=? AND file_revision=4 AND ordinal=6",
        )
        .run(f.fileId);
    if (change === "source-count") {
      const id = crypto.randomUUID();
      const encrypted = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        3,
        observation(7),
      );
      f.database.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,3,3,7,?)",
        )
        .run(id, observation(7).id, f.fileId, encrypted);
    }
    expect(await f.edits.publish(stage.g, stage.input.id)).toBe(false);
    expect(row(f).revision).toBe(3);
    expect(row(f).coverage_snapshot_id).toBe(before.coverage_snapshot_id);
    expect(count(f, "v2_file_edit_stages")).toBe(1);
  });
}

test("transaction rollback preserves source, stage and workspace revision", async () => {
  const f = await sourceFixture();
  const stage = await begin(f);
  await copyAll(f, stage);
  const before = row(f);
  f.database.sqlite.exec(
    "CREATE TRIGGER reject_edit BEFORE UPDATE OF revision ON v2_files WHEN NEW.revision=4 BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(f.edits.publish(stage.g, stage.input.id)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(row(f)).toEqual(before);
  expect(guard(f)).toEqual(stage.g);
  expect(count(f, "v2_file_edit_stages")).toBe(1);
  expect(
    f.database.sqlite
      .query("SELECT state FROM v2_private_snapshots WHERE id=?")
      .get(stage.input.coverageSnapshotId),
  ).toEqual({ state: "staging" });
  f.database.sqlite.exec("DROP TRIGGER reject_edit");
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(true);
});

test("10000 observations and 20000 derivatives survive bounded encrypted editing and complete pagination", async () => {
  const f = await sourceFixture(1, 1, true);
  const source = row(f);
  // Synthetic trusted processor output: real authenticated encrypted rows and one actually reserved/stored blob.
  // This setup does not assert an R2 object or live processor exists; the editor itself must copy every row.
  f.database.sqlite.query("DELETE FROM v2_file_observations WHERE file_id=?").run(f.fileId);
  f.database.sqlite.query("DELETE FROM v2_file_derivatives WHERE file_id=?").run(f.fileId);
  for (let i = 0; i < 20000; i++) {
    if (i < 10000) {
      const id = crypto.randomUUID();
      const value = { ...observation(i), text: i < 4 ? "😀".repeat(5000) : observation(i).text };
      const encrypted = await f.core.encrypt("v2_file_observations", id, f.actor.ownerId, 3, value);
      f.database.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,3,3,?,?,?)",
        )
        .run(id, value.id, f.fileId, i, encrypted, source.coverage_snapshot_id);
    }
    const id = crypto.randomUUID();
    const value = derivative(i);
    const encrypted = await f.core.encrypt("v2_file_derivatives", id, f.actor.ownerId, 3, value);
    f.database.sqlite
      .query(
        "INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,3,?,?,?,?,?)",
      )
      .run(
        id,
        value.id,
        f.fileId,
        value.kind,
        f.blobMap[derivative().id] ?? "",
        i,
        encrypted,
        source.coverage_snapshot_id,
      );
  }
  const metrics = { statements: 0, params: 0, batchBytes: 0, calls: 0, invocationQueries: 0 };
  const sizes = new WeakMap<D1PreparedStatement, number>();
  const prepare = f.database.binding.prepare.bind(f.database.binding);
  f.database.binding.prepare = (sql) => {
    metrics.calls++;
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      metrics.params = Math.max(metrics.params, values.length);
      const result = bind(...values);
      sizes.set(
        result,
        utf8Bytes(sql) +
          values.reduce<number>((n, v) => n + (typeof v === "string" ? utf8Bytes(v) : 16), 0),
      );
      return result;
    };
    return statement;
  };
  const changed = f.core.changed;
  f.core.changed = async (statements) => {
    metrics.statements = Math.max(metrics.statements, statements.length);
    metrics.batchBytes = Math.max(
      metrics.batchBytes,
      statements.reduce((n, s) => n + (sizes.get(s) ?? 0), 0),
    );
    return changed(statements);
  };
  const stage = await begin(f);
  const partCount = (
    f.database.sqlite
      .query("SELECT part_count FROM v2_private_snapshots WHERE id=?")
      .get(source.coverage_snapshot_id) as { part_count: number }
  ).part_count;
  for (let i = 0; i < partCount; i++) {
    const calls = metrics.calls;
    expect(await f.edits.copyCoveragePart(stage.g, stage.input.id, i)).toBe(true);
    metrics.invocationQueries = Math.max(metrics.invocationQueries, metrics.calls - calls);
  }
  for (let i = 0; i < 20000; i += 4) {
    const calls = metrics.calls;
    expect(
      await f.edits.copyPage(stage.g, stage.input.id, {
        observationOrdinal: Math.min(i, 10000),
        derivativeOrdinal: i,
      }),
    ).toBe(true);
    metrics.invocationQueries = Math.max(metrics.invocationQueries, metrics.calls - calls);
  }
  expect(await f.edits.publish(stage.g, stage.input.id)).toBe(true);
  for (let i = 0; i < 20000; i += 4) {
    if (i < 10000) {
      const page = await f.fileStaging.observations(f.actor, f.fileId, i - 1, 4);
      expect(page.length).toBe(4);
      for (const [offset, item] of page.entries()) {
        const ordinal = i + offset;
        const old = {
          ...observation(ordinal),
          text: ordinal < 4 ? "😀".repeat(5000) : observation(ordinal).text,
        };
        expect(item).toEqual({
          ordinal,
          value:
            ordinal === 0
              ? {
                  ...old,
                  text: stage.edit.text,
                  included: false,
                  userEdited: true,
                  certainty: "uncertain",
                }
              : old,
        });
      }
    }
    const page = await f.fileStaging.derivatives(f.actor, f.fileId, i - 1, 4);
    expect(page.length).toBe(4);
    for (const [offset, item] of page.entries())
      expect(item).toEqual({ ordinal: i + offset, value: derivative(i + offset) });
  }
  expect(await f.fileStaging.observations(f.actor, f.fileId, 9999, 4)).toEqual([]);
  expect(await f.fileStaging.derivatives(f.actor, f.fileId, 19999, 4)).toEqual([]);
  let coverageText = "";
  for await (const part of f.staging.fragments(f.actor, row(f).coverage_snapshot_id))
    coverageText += part.text;
  expect(JSON.parse(coverageText)).toEqual(f.value.coverage);
  expect(row(f).manifest_snapshot_id).toBe(source.manifest_snapshot_id);
  expect(metrics.statements).toBeLessThanOrEqual(40);
  expect(metrics.params).toBeLessThanOrEqual(100);
  expect(metrics.batchBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(metrics.calls).toBeGreaterThan(5000);
  expect(metrics.invocationQueries).toBeLessThanOrEqual(50);
  console.info("Synthetic file-edit SQL bounds", JSON.stringify(metrics));
}, 180000);
