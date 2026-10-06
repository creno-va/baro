import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { createCaseDataCipher, type EnvelopeCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z",
  HASH = "a".repeat(64),
  CIPHER = "b".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  }
});
async function fixture(bytes = 100) {
  const db = await createTestDatabase();
  databases.push(db);
  const user = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("p".repeat(32)).replace(/=+$/u, ""),
  });
  const core = createV2Core(db.binding, cipher),
    actor = { ownerId: user.userId, now: NOW };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID(),
    fileId = crypto.randomUUID(),
    uploadId = crypto.randomUUID(),
    reservationId = crypto.randomUUID();
  const workspace = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, workspace, NOW, NOW);
  db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
  const files = createV2FilesRepository(core),
    consentId = crypto.randomUUID();
  expect(
    await files.reserve(
      { ...actor, workspaceId, expectedRevision: 1 },
      {
        name: "합성😀.pdf",
        byteLength: bytes,
        mediaType: "application/pdf",
        autoProcessConsentVersion: "synthetic",
      },
      {
        fileId,
        uploadId,
        reservationId,
        consentId,
        expiresAt: "2026-10-06T01:00:00.000Z",
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: HASH,
        },
      },
    ),
  ).toBeTruthy();
  const input = {
    uploadId,
    uploadRevision: 1,
    ordinal: 0,
    blob: {
      id: crypto.randomUUID(),
      reservationId,
      kind: "original" as const,
      visibility: "private" as const,
      logicalBytes: Math.min(bytes, 8388608),
      cipherBytes: Math.min(bytes, 8388608) + 128,
      cipherHash: CIPHER,
      contentHash: HASH,
      keyVersion: "binary_v1",
    },
  };
  return {
    db,
    cipher,
    core,
    actor,
    workspaceId,
    fileId,
    consentId,
    files,
    input,
    storage: createV2StorageRepository(core),
  };
}
function rows(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    blobs: f.db.sqlite.query("SELECT * FROM v2_blobs ORDER BY id").all(),
    parts: f.db.sqlite.query("SELECT * FROM v2_upload_parts").all(),
    claims: f.db.sqlite.query("SELECT * FROM v2_mutation_claims").all(),
    usage: f.db.sqlite.query("SELECT * FROM v2_storage_usage").all(),
  };
}
test("actual original receipt atomically registers blob and encrypted part; duplicate never creates an extra blob", async () => {
  const f = await fixture();
  expect(await f.files.registerOriginalPart(f.actor, f.input)).toBe(true);
  const state = rows(f);
  expect(state.blobs).toHaveLength(1);
  expect(state.parts).toHaveLength(1);
  expect(state.claims).toEqual([]);
  const part = f.db.sqlite.query("SELECT encrypted_payload FROM v2_upload_parts").get() as {
    encrypted_payload: string;
  };
  expect(
    await f.core.decrypt(
      "v2_upload_parts",
      `${f.input.uploadId}-0`,
      f.actor.ownerId,
      1,
      part.encrypted_payload,
      z.unknown(),
    ),
  ).toEqual({
    blobId: f.input.blob.id,
    keyVersion: "binary_v1",
    contentHash: HASH,
    index: 0,
    byteLength: 100,
  });
  expect(
    await f.files.registerOriginalPart(f.actor, {
      ...f.input,
      blob: { ...f.input.blob, id: crypto.randomUUID() },
    }),
  ).toBe(false);
  expect(rows(f)).toEqual(state);
});
test("SQL failure in part insertion rolls back blob and claim; the original request can retry", async () => {
  const f = await fixture(),
    before = rows(f);
  f.db.sqlite.exec(
    "CREATE TRIGGER fail_part BEFORE INSERT ON v2_upload_parts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.files.registerOriginalPart(f.actor, f.input)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(rows(f)).toEqual(before);
  f.db.sqlite.exec("DROP TRIGGER fail_part");
  expect(await f.files.registerOriginalPart(f.actor, f.input)).toBe(true);
});
test("pending intent is not readable/stored or a part receipt; completion requires its exact typed anchor", async () => {
  const f = await fixture();
  expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
  expect(await f.storage.findBlob(f.actor, f.input.blob.id)).toBeNull();
  expect(rows(f).parts).toEqual([]);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
  expect(await f.files.recordOriginalDigest(f.actor, f.input.uploadId, 1, HASH)).toBe(false);
  expect(
    await f.files.registerOriginalPart(f.actor, {
      ...f.input,
      blob: { ...f.input.blob, contentHash: "c".repeat(64) },
    }),
  ).toBe(false);
  expect(await f.files.registerOriginalPart(f.actor, f.input)).toBe(true);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "stored" });
  expect(await f.files.abandonOriginalPart(f.actor, f.input.blob.id)).toBe(false);
});
test("pending intent index/revision/upload metadata, ciphertext tuple and five-minute expiry remain authoritative", async () => {
  for (const mode of ["index", "revision", "upload", "cipher", "expiry"] as const) {
    const f = await fixture();
    expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
    if (mode === "cipher")
      f.db.sqlite
        .query("UPDATE v2_blobs SET cipher_hash=? WHERE id=?")
        .run("c".repeat(64), f.input.blob.id);
    else if (mode !== "expiry") {
      const metadata = {
        contentHash: HASH,
        uploadId: mode === "upload" ? crypto.randomUUID() : f.input.uploadId,
        uploadRevision: mode === "revision" ? 2 : 1,
        ordinal: mode === "index" ? 1 : 0,
      };
      f.db.sqlite
        .query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?")
        .run(
          await f.core.encrypt("v2_blobs", f.input.blob.id, f.actor.ownerId, 1, metadata),
          f.input.blob.id,
        );
    }
    const before = rows(f);
    expect(
      await f.files.registerOriginalPart(
        { ...f.actor, now: mode === "expiry" ? "2026-10-06T00:05:00.000Z" : NOW },
        f.input,
      ),
    ).toBe(false);
    expect(rows(f)).toEqual(before);
  }
});
test("definitive abandoned pending intent gets an atomic cleanup journal without returning reserved storage", async () => {
  const f = await fixture();
  expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
  const usage = rows(f).usage;
  expect(await f.files.abandonOriginalPart(f.actor, f.input.blob.id)).toBe(true);
  expect(rows(f).usage).toEqual(usage);
  expect(f.db.sqlite.query("SELECT state,encrypted_payload FROM v2_blobs").get()).toEqual({
    state: "deleting",
    encrypted_payload: "removed",
  });
  expect(f.db.sqlite.query("SELECT kind,target_id FROM v2_deletion_targets").all()).toEqual([
    { kind: "blob", target_id: f.input.blob.id },
  ]);
  expect(await f.files.abandonOriginalPart(f.actor, f.input.blob.id)).toBe(false);
});
test("competing original receipts and pending intents have one winner without detached stored originals", async () => {
  for (const method of ["prepareOriginalPart", "registerOriginalPart"] as const) {
    const f = await fixture();
    const result = await Promise.all([
      f.files[method](f.actor, f.input),
      f.files[method](f.actor, { ...f.input, blob: { ...f.input.blob, id: crypto.randomUUID() } }),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(rows(f).blobs).toHaveLength(1);
    expect(rows(f).parts).toHaveLength(method === "prepareOriginalPart" ? 0 : 1);
  }
});
test("owner, expiry, cancellation, consent, operation, capacity and exact chunk boundaries reject without mutation", async () => {
  for (const mode of [
    "owner",
    "expiry",
    "cancel",
    "consent",
    "operation",
    "capacity",
    "ordinal",
    "length",
    "key",
  ] as const) {
    const f = await fixture();
    if (mode === "cancel")
      f.db.sqlite.query("UPDATE v2_upload_sessions SET state='cancelled'").run();
    if (mode === "consent") f.db.sqlite.query("DELETE FROM v2_consents").run();
    if (mode === "operation") f.db.sqlite.query("UPDATE v2_operations SET state='cancelled'").run();
    if (mode === "capacity")
      f.db.sqlite.query("UPDATE v2_storage_reservations SET byte_length=99").run();
    const a = {
      ...f.actor,
      ownerId: mode === "owner" ? "other-owner" : f.actor.ownerId,
      now: mode === "expiry" ? "2026-10-06T01:00:00.000Z" : NOW,
    };
    const input = {
      ...f.input,
      ordinal: mode === "ordinal" ? 1 : 0,
      blob: {
        ...f.input.blob,
        logicalBytes: mode === "length" ? 99 : 100,
        keyVersion: mode === "key" ? "1" : "binary_v1",
      },
    };
    const before = rows(f);
    expect(await f.files.registerOriginalPart(a, input)).toBe(false);
    expect(await f.files.prepareOriginalPart(a, input)).toBe(false);
    expect(rows(f)).toEqual(before);
  }
});
test("partial last chunk stores exact byte count and can adopt an old stored orphan receipt without double reservation", async () => {
  const f = await fixture(8388608 + 100);
  const last = {
    ...f.input,
    ordinal: 1,
    blob: { ...f.input.blob, logicalBytes: 100, cipherBytes: 228 },
  };
  expect(await f.storage.registerBlob(f.actor, last.blob)).toBe(true);
  const usage = rows(f).usage;
  expect(await f.files.registerOriginalPart(f.actor, last)).toBe(true);
  expect(rows(f).blobs).toHaveLength(1);
  expect(rows(f).usage).toEqual(usage);
});
test("upload cancellation during real encryption loses the final CAS and creates neither blob nor receipt", async () => {
  const f = await fixture();
  let changed = false;
  const cipher: EnvelopeCipher = {
    ...f.cipher,
    encrypt: async (text, context) => {
      const result = await f.cipher.encrypt(text, context);
      if (!changed && context.table === "v2_upload_parts") {
        changed = true;
        f.db.sqlite.query("UPDATE v2_upload_sessions SET state='cancelled'").run();
      }
      return result;
    },
  };
  const files = createV2FilesRepository(createV2Core(f.db.binding, cipher));
  expect(await files.registerOriginalPart(f.actor, f.input)).toBe(false);
  expect(rows(f).blobs).toEqual([]);
  expect(rows(f).parts).toEqual([]);
});
test("actual file deletion journals pending objects and denies late original completion", async () => {
  const f = await fixture();
  expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
  expect(
    await createV2DeletionRepository(f.core).file(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 2 },
      f.fileId,
      1,
    ),
  ).toBe(true);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  expect(await f.files.registerOriginalPart(f.actor, f.input)).toBe(false);
  expect(
    f.db.sqlite.query("SELECT target_id FROM v2_deletion_targets WHERE kind='blob'").all(),
  ).toEqual([{ target_id: f.input.blob.id }]);
});

test("failed intent cleanup retains the live upload reservation; retry and later file cleanup release it once", async () => {
  const f = await fixture();
  const deletion = createV2DeletionRepository(f.core);
  expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
  expect(await f.files.abandonOriginalPart(f.actor, f.input.blob.id)).toBe(true);
  const journal = f.db.sqlite
    .query("SELECT id FROM v2_deletion_journals WHERE target_kind='blob' AND target_id=?")
    .get(f.input.blob.id) as { id: string };
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:02:00.000Z",
  );
  if (!lease) throw new Error("Synthetic cleanup lease unavailable");
  const before = rows(f).usage;
  expect(
    await f.storage.confirmBlobDeleted(f.input.blob.id, NOW, {
      lease,
      receiptId: crypto.randomUUID(),
      objectKey: `private/${f.input.blob.id}`,
      cipherHash: CIPHER,
    }),
  ).toBe(true);
  expect(rows(f).usage).toEqual(before);
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_storage_reservations WHERE id=?")
      .get(f.input.blob.reservationId),
  ).toEqual({ state: "reserved" });
  expect(
    f.db.sqlite.query("SELECT reserved_count,reserved_bytes FROM v2_case_original_usage").get(),
  ).toEqual({ reserved_count: 1, reserved_bytes: 100 });
  const retry = { ...f.input, blob: { ...f.input.blob, id: crypto.randomUUID() } };
  expect(await f.files.prepareOriginalPart(f.actor, retry)).toBe(true);
  expect(await f.files.registerOriginalPart(f.actor, retry)).toBe(true);
  expect(
    await deletion.file(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 2 },
      f.fileId,
      1,
    ),
  ).toBe(true);
  const fileJournal = f.db.sqlite
    .query("SELECT id FROM v2_deletion_journals WHERE target_kind='file' AND target_id=?")
    .get(f.fileId) as { id: string };
  const fileLease = await deletion.acquire(
    fileJournal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:02:00.000Z",
  );
  if (!fileLease) throw new Error("Synthetic file cleanup lease unavailable");
  expect(
    await f.storage.confirmBlobDeleted(retry.blob.id, NOW, {
      lease: fileLease,
      receiptId: crypto.randomUUID(),
      objectKey: `private/${retry.blob.id}`,
      cipherHash: CIPHER,
    }),
  ).toBe(true);
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_storage_reservations WHERE id=?")
      .get(retry.blob.reservationId),
  ).toEqual({ state: "released" });
  expect(
    f.db.sqlite.query("SELECT reserved_count,reserved_bytes FROM v2_case_original_usage").get(),
  ).toEqual({ reserved_count: 0, reserved_bytes: 0 });
  expect(
    await f.storage.confirmBlobDeleted(retry.blob.id, NOW, {
      lease: fileLease,
      receiptId: crypto.randomUUID(),
      objectKey: `private/${retry.blob.id}`,
      cipherHash: CIPHER,
    }),
  ).toBe(false);
});

test("cleanup journal failure rolls pending abandonment back and another owner cannot abandon it", async () => {
  const f = await fixture();
  expect(await f.files.prepareOriginalPart(f.actor, f.input)).toBe(true);
  const before = rows(f);
  expect(
    await f.files.abandonOriginalPart({ ...f.actor, ownerId: "other-owner" }, f.input.blob.id),
  ).toBe(false);
  f.db.sqlite.exec(
    "CREATE TRIGGER fail_abandon BEFORE INSERT ON v2_deletion_targets BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.files.abandonOriginalPart(f.actor, f.input.blob.id)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(rows(f)).toEqual(before);
  expect(f.db.sqlite.query("SELECT * FROM v2_deletion_journals").all()).toEqual([]);
});
