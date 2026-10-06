import { afterEach, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { V2_LIMITS } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { digest, encryptPart, hex } from "../src/server/modules/files/binary";
import {
  createFilesService,
  type FileServiceDependencies,
  type PrivateBucket,
} from "../src/server/modules/files/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";
import { ready } from "./helpers/storage-capacity";

const NOW = "2026-10-06T00:00:00.000Z";
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
function r2() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const calls = { get: 0, put: 0, delete: 0 };
  let putHook: (() => Promise<void>) | undefined;
  let getHook: (() => Promise<void>) | undefined;
  let deleteFails = false;
  let putAmbiguous = false;
  let wrongReceipt = false;
  const port = {
    async put(key: string, value: Uint8Array<ArrayBuffer>) {
      calls.put++;
      objects.set(key, value.slice());
      await putHook?.();
      if (putAmbiguous) throw new Error("synthetic transport");
      return { key, size: value.byteLength + (wrongReceipt ? 1 : 0) };
    },
    async get(key: string) {
      calls.get++;
      await getHook?.();
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      calls.delete++;
      if (deleteFails) throw new Error("synthetic delete");
      objects.delete(key);
    },
  } as unknown as PrivateBucket;
  return {
    port,
    objects,
    calls,
    setPutHook(h: () => Promise<void>) {
      putHook = h;
    },
    setGetHook(h: () => Promise<void>) {
      getHook = h;
    },
    setDeleteFails(v: boolean) {
      deleteFails = v;
    },
    setPutAmbiguous(v: boolean) {
      putAmbiguous = v;
    },
    setWrongReceipt(v: boolean) {
      wrongReceipt = v;
    },
  };
}
async function drain(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      /* streamed validation */
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function fixture(
  overrides: Partial<FileServiceDependencies> = {},
  disabled: { admission?: true; probe?: true } = {},
  meteredReads = false,
) {
  const db = meteredReads ? (await ready({ getLimit: 2 })).db : await createTestDatabase();
  if (!meteredReads) dbs.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher);
  const actor = { ownerId: owner.userId, now: NOW };
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
    .run(workspaceId, actor.ownerId, payload, NOW, NOW);
  db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
  const bucket = r2();
  let currentNow = NOW;
  const deps: FileServiceDependencies = {
    environment: "preview",
    bucket: bucket.port,
    clock: () => currentNow,
    testOnlyUnmeteredStorage: true,
    probe: async (input) => {
      await drain(input.open());
      return {
        category: "document",
        format: "txt",
        byteLength: input.byteLength,
        pageCount: 1,
      };
    },
    ...overrides,
  };
  if (disabled.admission) delete deps.testOnlyUnmeteredStorage;
  if (disabled.probe) delete deps.probe;
  const service = createFilesService(core, deps);
  const rev = () =>
    Number(
      (
        db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
          revision: number;
        }
      ).revision,
    );
  return {
    db,
    core,
    actor,
    workspaceId,
    bucket,
    service,
    rev,
    setNow(v: string) {
      currentNow = v;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function reserved(
  f: Fixture,
  bytes: number,
  name = "합성💙 자료.txt",
  key = crypto.randomUUID(),
) {
  return f.service.reserve(f.actor.ownerId, f.workspaceId, f.rev(), key, {
    name,
    byteLength: bytes,
    mediaType: "text/plain",
    autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  });
}
async function uploaded(f: Fixture, bytes = new TextEncoder().encode("synthetic original")) {
  const session = await reserved(f, bytes.byteLength);
  const parts = [];
  for (let index = 0; index < Math.ceil(bytes.byteLength / V2_LIMITS.chunkBytes); index++) {
    const chunk = bytes.slice(index * V2_LIMITS.chunkBytes, (index + 1) * V2_LIMITS.chunkBytes);
    parts.push(
      await f.service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        session.fileId,
        session.uploadSession,
        index,
        new Response(chunk).body,
      ),
    );
  }
  const manifest = { byteLength: bytes.byteLength, contentHash: hex(sha256(bytes)), parts };
  const complete = await f.service.complete(f.actor.ownerId, f.workspaceId, session.fileId, {
    expectedRevision: f.rev(),
    uploadSession: session.uploadSession,
    manifest,
  });
  return { session, bytes, manifest, complete };
}
test("actual migrated SQL + AES upload completes trusted bytes and private streamed original download", async () => {
  const f = await fixture();
  const u = await uploaded(f);
  expect(u.complete).toMatchObject({ status: "uploaded", processingQueued: false, revision: 2 });
  const content = await f.service.content(f.actor.ownerId, f.workspaceId, u.session.fileId);
  expect(new Uint8Array(await new Response(content.body).arrayBuffer())).toEqual(u.bytes);
  const row = f.db.sqlite
    .query(
      "SELECT stored_count,reserved_count,stored_bytes FROM v2_case_original_usage WHERE workspace_id=?",
    )
    .get(f.workspaceId);
  expect(row).toEqual({ stored_count: 1, reserved_count: 0, stored_bytes: u.bytes.byteLength });
  expect([...f.bucket.objects.keys()].every((k) => /^private\/[A-Za-z0-9_-]+$/.test(k))).toBe(true);
  expect(
    [...f.bucket.objects.values()].every(
      (b) => !new TextDecoder().decode(b).includes("synthetic original"),
    ),
  ).toBe(true);
});
test("missing funding/probe deny processing without inventing zero-cost readiness", async () => {
  const f = await fixture({}, { admission: true });
  await expect(reserved(f, 5)).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect(f.bucket.calls.put).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_files").get()).toEqual({ n: 0 });
  const g = await fixture({}, { probe: true });
  const s = await reserved(g, 5);
  const p = await g.service.putPart(
    g.actor.ownerId,
    g.workspaceId,
    s.fileId,
    s.uploadSession,
    0,
    new Response(new Uint8Array(5)).body,
  );
  await expect(
    g.service.complete(g.actor.ownerId, g.workspaceId, s.fileId, {
      expectedRevision: g.rev(),
      uploadSession: s.uploadSession,
      manifest: { byteLength: 5, contentHash: await digest(new Uint8Array(5)), parts: [p] },
    }),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect((await createV2FilesRepository(g.core).metadata(g.actor, s.fileId))?.probe).toBeNull();
});
test("reservation and identical part replay are idempotent; changed bytes conflict", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const s = await reserved(f, 5, "name.txt", key);
  expect(
    await f.service.reserve(f.actor.ownerId, f.workspaceId, 1, key, {
      name: "name.txt",
      byteLength: 5,
      mediaType: "text/plain",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    }),
  ).toEqual(s);
  const put = () =>
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(5)).body,
    );
  const one = await put();
  expect(await put()).toEqual(one);
  expect(f.bucket.calls.put).toBe(1);
  await expect(
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array([1, 2, 3, 4, 5])).body,
    ),
  ).rejects.toThrow("CONFLICT");
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_upload_parts").get()).toEqual({ n: 1 });
});
test("concurrent part admission publishes exactly one ciphertext/receipt without over-reserving bytes", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  const put = () =>
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(5)).body,
    );
  const results = await Promise.allSettled([put(), put()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_upload_parts").get()).toEqual({ n: 1 });
  expect(f.bucket.calls.put).toBe(1);
  expect(await put()).toMatchObject({ index: 0, byteLength: 5 });
});
test("incorrect actual R2 put size cannot promote a pending intent to a stored receipt", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  f.bucket.setWrongReceipt(true);
  await expect(
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(5)).body,
    ),
  ).rejects.toThrow("STORAGE_UNAVAILABLE");
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
});
test("prepared intent survives interruption, cleanup preserves live upload and retry resumes", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  const data = new Uint8Array(5);
  const bytes = await encryptPart(
    f.core.cipher,
    {
      environment: "preview",
      ownerId: f.actor.ownerId,
      fileId: s.fileId,
      uploadId: s.uploadSession,
      revision: 1,
      index: 0,
      byteLength: 5,
    },
    data,
  );
  const reservation = f.db.sqlite
    .query("SELECT id FROM v2_storage_reservations WHERE entity_id=? AND kind='case_original'")
    .get(s.fileId) as { id: string };
  const blob = {
    id: crypto.randomUUID(),
    reservationId: reservation.id,
    kind: "original" as const,
    visibility: "private" as const,
    logicalBytes: 5,
    cipherBytes: bytes.byteLength,
    cipherHash: await digest(bytes),
    contentHash: await digest(data),
    keyVersion: "binary_v1",
  };
  expect(
    await createV2FilesRepository(f.core).prepareOriginalPart(f.actor, {
      uploadId: s.uploadSession,
      uploadRevision: 1,
      ordinal: 0,
      blob,
    }),
  ).toBe(true);
  await f.bucket.port.put(`private/${blob.id}`, bytes);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  await expect(f.service.content(f.actor.ownerId, f.workspaceId, s.fileId)).rejects.toThrow(
    "NOT_FOUND",
  );
  f.setNow("2026-10-06T00:05:00.000Z");
  expect(await f.service.recoverInterruptedUploads()).toBe(1);
  const deletion = createV2DeletionRepository(f.core);
  const journal = await deletion.findByTarget("blob", blob.id);
  if (!journal) throw new Error("missing intent journal");
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    "2026-10-06T00:05:00.000Z",
    "2026-10-06T00:06:00.000Z",
  );
  if (!lease) throw new Error("missing intent lease");
  expect(await f.service.cleanup(lease)).toBe(true);
  expect(
    f.db.sqlite.query("SELECT state FROM v2_storage_reservations WHERE id=?").get(reservation.id),
  ).toEqual({ state: "reserved" });
  expect(
    f.db.sqlite
      .query(
        "SELECT reserved_count,reserved_bytes FROM v2_case_original_usage WHERE workspace_id=?",
      )
      .get(f.workspaceId),
  ).toEqual({ reserved_count: 1, reserved_bytes: 5 });
  expect(
    await f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(data).body,
    ),
  ).toMatchObject({ index: 0, byteLength: 5 });
});
test("complete replay does not invoke probe twice; stale revision/wrong hash fail before publication", async () => {
  let probes = 0;
  const f = await fixture({
    probe: async (input) => {
      probes++;
      await drain(input.open());
      return { category: "document", format: "txt", byteLength: input.byteLength, pageCount: 1 };
    },
  });
  const u = await uploaded(f);
  expect(
    await f.service.complete(f.actor.ownerId, f.workspaceId, u.session.fileId, {
      expectedRevision: 2,
      uploadSession: u.session.uploadSession,
      manifest: u.manifest,
    }),
  ).toEqual(u.complete);
  expect(probes).toBe(1);
  await expect(
    f.service.complete(f.actor.ownerId, f.workspaceId, u.session.fileId, {
      expectedRevision: 2,
      uploadSession: u.session.uploadSession,
      manifest: { ...u.manifest, contentHash: "0".repeat(64) },
    }),
  ).rejects.toThrow("CONFLICT");
  const s = await reserved(f, 5);
  const p = await f.service.putPart(
    f.actor.ownerId,
    f.workspaceId,
    s.fileId,
    s.uploadSession,
    0,
    new Response(new Uint8Array(5)).body,
  );
  await expect(
    f.service.complete(f.actor.ownerId, f.workspaceId, s.fileId, {
      expectedRevision: f.rev() - 1,
      uploadSession: s.uploadSession,
      manifest: { byteLength: 5, contentHash: await digest(new Uint8Array(5)), parts: [p] },
    }),
  ).rejects.toThrow("CONFLICT");
  expect(probes).toBe(1);
});
test("wrong owner/workspace/upload/index, expiry and revocation reject before body consumption/R2", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  let pulls = 0;
  const body = () =>
    new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulls++;
          c.enqueue(new Uint8Array(5));
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
  for (const [caseId, fileId, upload, index] of [
    [crypto.randomUUID(), s.fileId, s.uploadSession, 0],
    [f.workspaceId, crypto.randomUUID(), s.uploadSession, 0],
    [f.workspaceId, s.fileId, crypto.randomUUID(), 0],
    [f.workspaceId, s.fileId, s.uploadSession, 1],
  ] as const)
    await expect(
      f.service.putPart(f.actor.ownerId, caseId, fileId, upload, index, body()),
    ).rejects.toThrow();
  expect(pulls).toBe(0);
  expect(f.bucket.calls.put).toBe(0);
  f.setNow("2026-10-06T01:00:00.000Z");
  await expect(
    f.service.putPart(f.actor.ownerId, f.workspaceId, s.fileId, s.uploadSession, 0, body()),
  ).rejects.toThrow("NOT_FOUND");
  expect(pulls).toBe(0);
  f.setNow(NOW);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  await expect(
    f.service.putPart(f.actor.ownerId, f.workspaceId, s.fileId, s.uploadSession, 0, body()),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect(pulls).toBe(0);
});
test("partial/oversized chunk and corrupt whole hash cannot finish or commit storage", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  await expect(
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(4)).body,
    ),
  ).rejects.toThrow("INVALID_FILE");
  await expect(
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(6)).body,
    ),
  ).rejects.toThrow("BODY_TOO_LARGE");
  const p = await f.service.putPart(
    f.actor.ownerId,
    f.workspaceId,
    s.fileId,
    s.uploadSession,
    0,
    new Response(new Uint8Array(5)).body,
  );
  await expect(
    f.service.complete(f.actor.ownerId, f.workspaceId, s.fileId, {
      expectedRevision: f.rev(),
      uploadSession: s.uploadSession,
      manifest: { byteLength: 5, contentHash: "0".repeat(64), parts: [p] },
    }),
  ).rejects.toThrow("INVALID_FILE");
  expect(
    f.db.sqlite.query("SELECT state FROM v2_storage_reservations WHERE kind='case_original'").get(),
  ).toEqual({ state: "reserved" });
  expect(f.db.sqlite.query("SELECT state FROM v2_upload_sessions").get()).toEqual({
    state: "open",
  });
});
test("two full binary chunks stream losslessly without whole-file hashing allocation", async () => {
  const f = await fixture();
  const bytes = new Uint8Array(V2_LIMITS.chunkBytes + 7);
  bytes[0] = 255;
  bytes[V2_LIMITS.chunkBytes] = 42;
  const u = await uploaded(f, bytes);
  const content = await f.service.content(f.actor.ownerId, f.workspaceId, u.session.fileId);
  const reader = content.body.getReader();
  const first = await reader.read();
  const second = await reader.read();
  expect(first.value?.byteLength).toBe(V2_LIMITS.chunkBytes);
  expect(first.value?.[0]).toBe(255);
  expect(second.value).toEqual(bytes.slice(V2_LIMITS.chunkBytes));
  expect((await reader.read()).done).toBe(true);
}, 30000);
test("deleted-file race after R2 put leaves durable orphan cleanup and retains storage until receipt", async () => {
  const f = await fixture();
  const s = await reserved(f, 5);
  f.bucket.setPutHook(async () => {
    await f.service.remove(f.actor.ownerId, f.workspaceId, s.fileId, f.rev(), 1);
  });
  f.bucket.setDeleteFails(true);
  await expect(
    f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(new Uint8Array(5)).body,
    ),
  ).rejects.toThrow();
  expect(f.bucket.objects.size).toBe(1);
  const b = f.db.sqlite.query("SELECT id FROM v2_blobs WHERE state='deleting'").get() as {
    id: string;
  };
  expect(b).toBeTruthy();
  const deletion = createV2DeletionRepository(f.core);
  const journal = await deletion.findByTarget("file", s.fileId);
  if (!journal) throw new Error("missing synthetic journal");
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:01:00.000Z",
  );
  if (!lease) throw new Error("missing lease");
  f.bucket.setDeleteFails(true);
  await expect(f.service.cleanup(lease)).rejects.toThrow();
  expect(f.bucket.objects.size).toBe(1);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(b.id)).toEqual({
    state: "deleting",
  });
  f.bucket.setDeleteFails(false);
  expect(await f.service.cleanup(lease)).toBe(true);
  expect(f.bucket.objects.size).toBe(0);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(b.id)).toEqual({
    state: "deleted",
  });
});
test("download deletion/cipher modification races publish no next plaintext chunk", async () => {
  const f = await fixture();
  const u = await uploaded(f);
  const content = await f.service.content(f.actor.ownerId, f.workspaceId, u.session.fileId);
  f.bucket.setGetHook(async () => {
    await f.service.remove(f.actor.ownerId, f.workspaceId, u.session.fileId, f.rev(), 2);
  });
  await expect(content.body.getReader().read()).rejects.toThrow("INVALID_FILE");
  const g = await fixture();
  const v = await uploaded(g);
  const obj = [...g.bucket.objects.values()][0];
  if (!obj) throw new Error("Synthetic stored ciphertext missing");
  obj[obj.length - 1] = (obj[obj.length - 1] ?? 0) ^ 1;
  const bad = await g.service.content(g.actor.ownerId, g.workspaceId, v.session.fileId);
  await expect(bad.body.getReader().read()).rejects.toThrow("INVALID_FILE");
});
test("maximum supplementary Unicode names and exact storage/case admission counters", async () => {
  const f = await fixture();
  const name = `${"💙".repeat(251)}.txt`;
  expect([...name]).toHaveLength(255);
  expect(name.length).toBeGreaterThan(255);
  const s = await reserved(f, 5, name);
  expect((await createV2FilesRepository(f.core).metadata(f.actor, s.fileId))?.name).toBe(name);
  f.db.sqlite
    .query("UPDATE v2_case_original_usage SET stored_count=99 WHERE workspace_id=?")
    .run(f.workspaceId);
  await expect(reserved(f, 5)).rejects.toThrow("CONFLICT");
  f.db.sqlite
    .query("UPDATE v2_case_original_usage SET stored_count=0 WHERE workspace_id=?")
    .run(f.workspaceId);
  f.db.sqlite.query("UPDATE v2_storage_usage SET stored_bytes=9999999995").run();
  await expect(reserved(f, 1)).rejects.toThrow("CONFLICT");
});

test("completion requires a fully validated single processor read", async () => {
  for (const partial of [false, true]) {
    const f = await fixture({
      probe: async (input) => {
        if (partial) {
          const reader = input.open().getReader();
          await reader.read();
          await reader.cancel();
        }
        return { category: "document", format: "txt", byteLength: input.byteLength, pageCount: 1 };
      },
    });
    const s = await reserved(f, 5);
    const data = new Uint8Array(5);
    const p = await f.service.putPart(
      f.actor.ownerId,
      f.workspaceId,
      s.fileId,
      s.uploadSession,
      0,
      new Response(data).body,
    );
    await expect(
      f.service.complete(f.actor.ownerId, f.workspaceId, s.fileId, {
        expectedRevision: f.rev(),
        uploadSession: s.uploadSession,
        manifest: { byteLength: 5, contentHash: hex(sha256(data)), parts: [p] },
      }),
    ).rejects.toThrow("INVALID_FILE");
    expect(f.db.sqlite.query("SELECT state FROM v2_upload_sessions").get()).toEqual({
      state: "open",
    });
  }
});
test("private GETs consume maintenance counters once per chunk and deny exhausted reads; completion stays within the 120-chunk D1 bound", async () => {
  const f = await fixture({}, {}, true);
  const data = new Uint8Array(V2_LIMITS.chunkBytes + 7);
  const s = await reserved(f, data.length);
  f.bucket.setPutHook(async () => {
    for (const b of f.db.sqlite
      .query("SELECT id,object_key,cipher_bytes FROM v2_blobs WHERE state='pending'")
      .all() as { id: string; object_key: string; cipher_bytes: number }[]) {
      f.db.sqlite
        .query(`INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,writer_state,created_at)
        VALUES(?,'preview',?,?,?,'held','stopped',?)`)
        .run(b.id, f.actor.ownerId, b.object_key, b.cipher_bytes, NOW);
    }
  });
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const chunk = data.slice(i * V2_LIMITS.chunkBytes, (i + 1) * V2_LIMITS.chunkBytes);
    parts.push(
      await f.service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        s.fileId,
        s.uploadSession,
        i,
        new Response(chunk).body,
      ),
    );
  }
  const metered = createFilesService(f.core, {
    environment: "preview",
    bucket: f.bucket.port,
    clock: () => NOW,
    probe: async (input) => {
      await drain(input.open());
      return { category: "document", format: "txt", byteLength: input.byteLength, pageCount: 1 };
    },
  });
  const before = f.db.queryCount,
    gets = f.bucket.calls.get;
  await metered.complete(f.actor.ownerId, f.workspaceId, s.fileId, {
    expectedRevision: f.rev(),
    uploadSession: s.uploadSession,
    manifest: { byteLength: data.length, contentHash: hex(sha256(data)), parts },
  });
  // Seven D1 statements per additional chunk; measured fixed completion overhead.
  expect(f.db.queryCount - before + (120 - 2) * 7).toBeLessThanOrEqual(1000);
  expect(f.bucket.calls.get - gets).toBe(2);
  expect(f.db.sqlite.query("SELECT gets FROM v2_storage_projections").get()).toEqual({ gets: 2 });
  const content = await metered.content(f.actor.ownerId, f.workspaceId, s.fileId);
  await expect(content.body.getReader().read()).rejects.toThrow("INVALID_FILE");
  expect(f.bucket.calls.get - gets).toBe(2);
}, 30000);
