import { afterEach, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { digest, encryptPart } from "../src/server/modules/files/binary";
import { reconcileFileUploads } from "../src/server/modules/files/reconcile";
import { createFilesService, type PrivateBucket } from "../src/server/modules/files/service";
import type { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";
import { ready } from "./helpers/storage-capacity";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  }
});
async function fixture(limits: { headLimit?: number; deleteLimit?: number } = {}) {
  const { db } = await ready({ getLimit: 100, headLimit: 100, deleteLimit: 100, ...limits });
  const old = new Date(Date.now() - 360000).toISOString();
  const user = await seedTestSession(db, { now: Date.parse(old), consent: true });
  const key = btoa("r".repeat(32)).replace(/=+$/u, "");
  const cipher = await createCaseDataCipher({ CASE_DATA_KEY_V1: key });
  const core = createV2Core(db.binding, cipher),
    actor = { ownerId: user.userId, now: old };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const payload = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, payload, old, old);
  db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  let deleteFails = false,
    deleteCalls = 0,
    headCalls = 0;
  let deleteHook: (() => void) | undefined;
  const bucket = {
    async put(k: string, v: Uint8Array<ArrayBuffer>) {
      objects.set(k, v.slice());
      return { key: k, size: v.byteLength };
    },
    async get(k: string) {
      const v = objects.get(k);
      return v ? { key: k, size: v.byteLength, body: new Response(v.slice()).body } : null;
    },
    async head(k: string) {
      headCalls++;
      const v = objects.get(k);
      return v ? { key: k, size: v.byteLength } : null;
    },
    async delete(k: string) {
      deleteCalls++;
      if (deleteFails) throw new Error("synthetic R2 deletion");
      objects.delete(k);
      deleteHook?.();
    },
  } as unknown as PrivateBucket;
  const env = {
    DB: db.binding,
    APP_ENV: "preview",
    CASE_DATA_KEY_V1: key,
    CASE_PRIVATE_R2: bucket,
  } as unknown as Env;
  const files = createV2FilesRepository(core),
    service = createFilesService(core, {
      environment: "preview",
      bucket,
      testOnlyUnmeteredStorage: true,
    });
  async function pending(runningWriter = false) {
    const revision = (
      db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
        revision: number;
      }
    ).revision;
    const fileId = crypto.randomUUID(),
      uploadId = crypto.randomUUID(),
      reservationId = crypto.randomUUID();
    const bytes = new TextEncoder().encode("synthetic stale original");
    expect(
      await files.reserve(
        { ...actor, workspaceId, expectedRevision: revision },
        {
          name: "합성 원본.txt",
          mediaType: "text/plain",
          byteLength: bytes.byteLength,
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        },
        {
          fileId,
          uploadId,
          reservationId,
          consentId: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          admission: {
            operationId: crypto.randomUUID(),
            requestHash: "a".repeat(64),
            key: crypto.randomUUID(),
          },
        },
      ),
    ).toBeTruthy();
    const frame = await encryptPart(
      cipher,
      {
        environment: "preview",
        ownerId: actor.ownerId,
        fileId,
        uploadId,
        revision: 1,
        index: 0,
        byteLength: bytes.byteLength,
      },
      bytes,
    );
    const input = {
      uploadId,
      uploadRevision: 1,
      ordinal: 0,
      blob: {
        id: crypto.randomUUID(),
        reservationId,
        kind: "original" as const,
        visibility: "private" as const,
        logicalBytes: bytes.byteLength,
        cipherBytes: frame.byteLength,
        cipherHash: await digest(frame),
        contentHash: await digest(bytes),
        keyVersion: "binary_v1",
      },
    };
    expect(await files.prepareOriginalPart(actor, input)).toBe(true);
    db.sqlite
      .query(`INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,writer_state,created_at)
      VALUES(?,'preview',?,?,?,'held',?,?)`)
      .run(
        input.blob.id,
        actor.ownerId,
        `private/${input.blob.id}`,
        frame.byteLength,
        runningWriter ? "prepared" : "stopped",
        old,
      );
    if (runningWriter)
      db.sqlite
        .query(
          "UPDATE v2_physical_blob_bindings SET writer_state='running',writer_token=?,expected_cipher_bytes=maximum_cipher_bytes WHERE blob_id=?",
        )
        .run(crypto.randomUUID(), input.blob.id);
    objects.set(`private/${input.blob.id}`, frame);
    return { input, fileId, uploadId, bytes };
  }
  return {
    db,
    core,
    actor,
    env,
    bucket,
    service,
    files,
    workspaceId,
    objects,
    pending,
    setDeleteFails: (v: boolean) => {
      deleteFails = v;
    },
    deleteCalls: () => deleteCalls,
    headCalls: () => headCalls,
    setDeleteHook: (fn: () => void) => {
      deleteHook = fn;
    },
  };
}
test("cron recovers an actual encrypted stale intent, deletes its R2 object, keeps the live reservation and allows resume", async () => {
  const f = await fixture(),
    p = await f.pending();
  expect(await reconcileFileUploads(f.env)).toEqual({
    recovered: 1,
    acquired: 1,
    completed: 1,
    retry: 0,
    unavailable: false,
  });
  expect(f.objects.size).toBe(0);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleted" });
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_reservations").get()).toEqual({
    state: "reserved",
  });
  expect(
    f.db.sqlite.query("SELECT reserved_count,reserved_bytes FROM v2_case_original_usage").get(),
  ).toEqual({ reserved_count: 1, reserved_bytes: p.bytes.byteLength });
  expect(f.db.sqlite.query("SELECT state,attempts FROM v2_deletion_journals").get()).toEqual({
    state: "completed",
    attempts: 1,
  });
  expect(
    await f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      p.fileId,
      p.uploadId,
      0,
      new Response(p.bytes).body,
    ),
  ).toMatchObject({ index: 0, byteLength: p.bytes.byteLength });
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_upload_parts").get()).toEqual({
    count: 1,
  });
  expect((await reconcileFileUploads(f.env)).acquired).toBe(0);
  expect(f.deleteCalls()).toBe(1);
  expect(f.headCalls()).toBe(1);
  expect(f.db.sqlite.query("SELECT deletes,heads FROM v2_storage_projections").get()).toEqual({
    deletes: 1,
    heads: 1,
  });
});
test("R2 deletion failure writes no receipt, keeps exposure and leaves a retryable journal for the next cron", async () => {
  const f = await fixture();
  await f.pending();
  f.setDeleteFails(true);
  expect(await reconcileFileUploads(f.env)).toMatchObject({
    acquired: 1,
    completed: 0,
    retry: 1,
    unavailable: false,
  });
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cleanup_receipts").get()).toEqual({
    count: 0,
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  expect(f.db.sqlite.query("SELECT state,lease_token FROM v2_deletion_journals").get()).toEqual({
    state: "failed",
    lease_token: null,
  });
  expect((await reconcileFileUploads(f.env)).acquired).toBe(0);
  f.db.sqlite.query("UPDATE v2_deletion_journals SET next_attempt_at=?").run(f.actor.now);
  f.setDeleteFails(false);
  expect(await reconcileFileUploads(f.env)).toMatchObject({ completed: 1, retry: 0 });
  expect(f.objects.size).toBe(0);
});
test("scheduler bounds recovery and isolated original journals to four", async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++) await f.pending();
  expect(await reconcileFileUploads(f.env)).toMatchObject({
    recovered: 4,
    acquired: 4,
    completed: 4,
  });
  expect(f.deleteCalls()).toBe(4);
  expect(
    f.db.sqlite.query("SELECT count(*) AS count FROM v2_blobs WHERE state='pending'").get(),
  ).toEqual({ count: 2 });
  expect(await reconcileFileUploads(f.env)).toMatchObject({ recovered: 2, completed: 2 });
});
test("job and reservation inventories, foreign blob kinds and active leases are never acquired or bypassed", async () => {
  for (const mode of ["job", "reservation", "foreign", "lease"] as const) {
    const f = await fixture(),
      p = await f.pending();
    expect(
      await f.files.abandonOriginalPart(
        { ...f.actor, now: new Date().toISOString() },
        p.input.blob.id,
      ),
    ).toBe(true);
    const journal = f.db.sqlite.query("SELECT id FROM v2_deletion_journals").get() as {
      id: string;
    };
    if (mode === "job" || mode === "reservation")
      f.db.sqlite
        .query("INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) VALUES(?,1,?,?)")
        .run(journal.id, mode, crypto.randomUUID());
    if (mode === "foreign") f.db.sqlite.query("UPDATE v2_blobs SET kind='derivative'").run();
    if (mode === "lease")
      expect(
        await createV2DeletionRepository(f.core).acquire(
          journal.id,
          crypto.randomUUID(),
          new Date().toISOString(),
          new Date(Date.now() + 120000).toISOString(),
        ),
      ).toBeTruthy();
    expect((await reconcileFileUploads(f.env)).acquired).toBe(0);
    expect(f.deleteCalls()).toBe(0);
    expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cleanup_receipts").get()).toEqual({
      count: 0,
    });
  }
});
test("expired upload recovery leaves file/reservation inventory incomplete for #67", async () => {
  const f = await fixture(),
    p = await f.pending();
  f.db.sqlite.query("UPDATE v2_upload_sessions SET expires_at=?").run(f.actor.now);
  expect(await reconcileFileUploads(f.env)).toMatchObject({ recovered: 2, completed: 1 });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_deletion_journals WHERE target_kind='file'").get(),
  ).toEqual({ state: "pending" });
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_deletion_targets WHERE kind='reservation' AND target_id=?")
      .get(p.input.blob.reservationId),
  ).toEqual({ state: "pending" });
});
test("missing bucket or key keeps all work incomplete without receipts", async () => {
  const f = await fixture();
  await f.pending();
  expect(
    (await reconcileFileUploads({ ...f.env, CASE_PRIVATE_R2: undefined } as unknown as Env))
      .unavailable,
  ).toBe(true);
  expect((await reconcileFileUploads({ ...f.env, CASE_DATA_KEY_V1: "invalid" })).unavailable).toBe(
    true,
  );
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
  expect(f.objects.size).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cleanup_receipts").get()).toEqual({
    count: 0,
  });
});

test("cron finishes a journal interrupted after all actual blob receipts without repeating R2 deletion", async () => {
  const f = await fixture();
  const p = await f.pending();
  expect(
    await f.files.abandonOriginalPart(
      { ...f.actor, now: new Date().toISOString() },
      p.input.blob.id,
    ),
  ).toBe(true);
  const journal = f.db.sqlite.query("SELECT id FROM v2_deletion_journals").get() as { id: string };
  const deletion = createV2DeletionRepository(f.core);
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    new Date().toISOString(),
    new Date(Date.now() + 60000).toISOString(),
  );
  if (!lease) throw new Error("Synthetic cleanup lease unavailable");
  expect(await f.service.cleanup(lease)).toBe(true);
  f.db.sqlite
    .query(
      "UPDATE v2_deletion_journals SET state='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=?",
    )
    .run(f.actor.now);
  const receipts = f.db.sqlite.query("SELECT * FROM v2_cleanup_receipts").all();
  expect(await reconcileFileUploads(f.env)).toMatchObject({ recovered: 0, completed: 1, retry: 0 });
  expect(f.deleteCalls()).toBe(1);
  expect(f.db.sqlite.query("SELECT * FROM v2_cleanup_receipts").all()).toEqual(receipts);
});

test("cleanup budgets stop actual DELETE/HEAD and never fabricate absence receipts", async () => {
  for (const limits of [{ deleteLimit: 0 }, { headLimit: 0 }]) {
    const f = await fixture(limits);
    await f.pending();
    expect(await reconcileFileUploads(f.env)).toMatchObject({ completed: 0, retry: 1 });
    expect(f.deleteCalls()).toBe(limits.deleteLimit === 0 ? 0 : 1);
    expect(f.headCalls()).toBe(0);
    expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cleanup_receipts").get()).toEqual({
      count: 0,
    });
    expect(f.db.sqlite.query("SELECT state FROM v2_physical_blob_bindings").get()).toEqual({
      state: "held",
    });
  }
});
test("a revoked cleanup lease after DELETE prevents HEAD and receipt; a running writer prevents DELETE", async () => {
  const f = await fixture();
  await f.pending();
  f.setDeleteHook(() => {
    f.db.sqlite.query("UPDATE v2_deletion_journals SET lease_until=?").run(f.actor.now);
  });
  expect(await reconcileFileUploads(f.env)).toMatchObject({ completed: 0, retry: 1 });
  expect(f.deleteCalls()).toBe(1);
  expect(f.headCalls()).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_cleanup_receipts").get()).toEqual({
    count: 0,
  });
  const g = await fixture();
  await g.pending(true);
  expect(await reconcileFileUploads(g.env)).toMatchObject({ completed: 0, retry: 1 });
  expect(g.deleteCalls()).toBe(0);
});
