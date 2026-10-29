import { expect, test } from "bun:test";
import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { saveAccountType } from "../src/server/auth/account-type";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { DefinitiveFileRejection } from "../src/server/modules/file-processing/protocol";
import { digest } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { createFileProcessingAdmission } from "../src/server/runtime/file-admission";
import { fixture } from "./helpers/file-processing-fixture";

// Real SQLite/AES/storage and inline native admission. Only native bytes/probe
// responses and R2 are explicit offline adapters; no live failure is inferred.
async function setup() {
  const f = await fixture();
  const clock = () => f.actor.now;
  const core = createV2Core(f.db.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const source = new TextEncoder().encode("synthetic second original");
  const peerSource = new TextEncoder().encode("synthetic first original");
  const calls = { probe: 0, stop: 0 };
  let duringProbe: (() => Promise<void>) | undefined;
  let refusal = false;
  const env = {
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    DB: f.db.binding,
    FILE_PROCESSOR: {
      idFromName: (id: string) => id,
      get: () => ({
        prepareCapacity: async () => true,
        stopProcessing: async () => {
          calls.stop++;
        },
        fetch: async (request: Request) => {
          expect(new URL(request.url).pathname).toBe("/probe");
          const bytes = new Uint8Array(await request.arrayBuffer());
          expect([source, peerSource]).toContainEqual(bytes);
          calls.probe++;
          const next = duringProbe;
          duringProbe = undefined;
          await next?.();
          if (refusal)
            return Response.json(
              { code: "INVALID_MEDIA", rejection: "office_input" },
              { status: 422 },
            );
          return Response.json({
            version: 1,
            probe: {
              category: "document",
              format: "txt",
              byteLength: bytes.length,
              pageCount: 1,
            },
          });
        },
      }),
    },
  } as unknown as Env;
  const service = (part = false) => {
    const requestCore = part ? fileStorageRequestCore(core, false) : core;
    return createFilesService(requestCore, {
      environment: "preview",
      bucket: f.bucket.port,
      clock,
      paidStorage: createFileStorageBudget(requestCore, "preview", f.actor.ownerId, clock),
      ...createFileProcessingAdmission(requestCore, env, {}, clock),
    });
  };
  const prepare = async (bytes: Uint8Array<ArrayBuffer>, name: string) => {
    const expectedRevision = f.rev(),
      key = crypto.randomUUID();
    const input = {
      name,
      byteLength: bytes.length,
      mediaType: "text/plain",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      contentHash: await digest(bytes),
    };
    const session = await service().reserve(
      f.actor.ownerId,
      f.workspaceId,
      expectedRevision,
      key,
      input,
    );
    const part = await service(true).putPart(
      f.actor.ownerId,
      f.workspaceId,
      session.fileId,
      session.uploadSession,
      0,
      new Response(bytes).body,
    );
    const manifest = { byteLength: bytes.length, contentHash: input.contentHash, parts: [part] };
    return { session, manifest, input, key, expectedRevision };
  };
  const peer = await prepare(peerSource, "first.txt"),
    target = await prepare(source, "second.txt");
  const complete = (item: typeof target, expectedRevision = f.rev()) =>
    service().complete(f.actor.ownerId, f.workspaceId, item.session.fileId, {
      expectedRevision,
      uploadSession: item.session.uploadSession,
      manifest: item.manifest,
    });
  const stored = () => ({
    reservations: f.db.sqlite.query("SELECT * FROM v2_storage_reservations ORDER BY id").all(),
    parts: f.db.sqlite.query("SELECT * FROM v2_upload_parts ORDER BY upload_id,ordinal").all(),
    sessions: f.db.sqlite.query("SELECT * FROM v2_upload_sessions ORDER BY id").all(),
    operations: f.db.sqlite.query("SELECT * FROM v2_operations ORDER BY id").all(),
    holds: f.db.sqlite.query("SELECT * FROM v2_paid_holds ORDER BY attempt_id").all(),
    admissions: f.db.sqlite
      .query("SELECT * FROM v2_execution_admissions ORDER BY invocation_id")
      .all(),
    objects: [...f.bucket.objects].map(([key, value]) => [key, [...value]]),
  });
  return {
    ...f,
    core,
    service,
    source,
    peerSource,
    peer,
    target,
    calls,
    complete,
    stored,
    refuseProbe: () => {
      refusal = true;
    },
    onProbe: (next: () => Promise<void>) => {
      duringProbe = next;
    },
  };
}

test("control: native admission completes two originals and finalized replay does not probe again", async () => {
  const f = await setup();
  expect(await f.complete(f.peer)).toMatchObject({ status: "uploaded", processingQueued: false });
  expect(await f.complete(f.target)).toMatchObject({ status: "uploaded", processingQueued: false });
  const before = f.stored();
  expect(await f.complete(f.target, 1)).toMatchObject({
    status: "uploaded",
    processingQueued: false,
  });
  expect(f.stored()).toEqual(before);
  expect(f.calls).toEqual({ probe: 2, stop: 2 });
  expect(
    new Uint8Array(
      await new Response(
        (await f.service().content(f.actor.ownerId, f.workspaceId, f.target.session.fileId)).body,
      ).arrayBuffer(),
    ),
  ).toEqual(f.source);
});

test("competing completion preserves an open digest and explicit same-session recovery completes safely", async () => {
  const f = await setup();
  const expectedRevision = f.rev();
  const before = f.stored();
  f.onProbe(async () => {
    expect(await f.complete(f.peer)).toMatchObject({ status: "uploaded", processingQueued: false });
  });
  await expect(f.complete(f.target, expectedRevision)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.rev()).toBe(expectedRevision + 1);
  expect(f.calls).toEqual({ probe: 2, stop: 2 });
  const file = f.db.sqlite
    .query("SELECT state,revision,manifest_snapshot_id,current_job_id FROM v2_files WHERE id=?")
    .get(f.target.session.fileId);
  expect(file).toEqual({
    state: "reserved",
    revision: 1,
    manifest_snapshot_id: null,
    current_job_id: null,
  });
  const upload = f.db.sqlite
    .query("SELECT state,revision,encrypted_payload FROM v2_upload_sessions WHERE id=?")
    .get(f.target.session.uploadSession) as {
    state: string;
    revision: number;
    encrypted_payload: string;
  };
  expect(upload.state).toBe("open");
  expect(
    await f.core.decrypt(
      "v2_upload_sessions",
      f.target.session.uploadSession,
      f.actor.ownerId,
      upload.revision,
      upload.encrypted_payload,
      z.strictObject({ contentHash: z.string() }),
    ),
  ).toEqual({ contentHash: f.target.manifest.contentHash });
  const blocked = f.stored();
  expect(blocked.parts).toEqual(before.parts);
  expect(blocked.objects).toEqual(before.objects);
  expect(blocked.reservations).toHaveLength(before.reservations.length);
  expect(blocked.sessions).toHaveLength(2);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_outbox").get()).toEqual({ n: 0 });
  // An explicit replay retains the exact reserve key/session and source bytes.
  expect(
    await f
      .service()
      .reserve(
        f.actor.ownerId,
        f.workspaceId,
        f.target.expectedRevision,
        f.target.key,
        f.target.input,
      ),
  ).toEqual(f.target.session);
  await expect(
    f.service().content(f.actor.ownerId, f.workspaceId, f.target.session.fileId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await f.complete(f.target)).toMatchObject({ status: "uploaded", processingQueued: false });
  expect(f.calls).toEqual({ probe: 3, stop: 3 });
  const recovered = f.stored();
  expect(recovered.parts).toEqual(blocked.parts);
  expect(recovered.objects).toEqual(blocked.objects);
  expect(recovered.reservations).toEqual(blocked.reservations);
  expect(recovered.sessions).toHaveLength(blocked.sessions.length);
  expect(recovered.holds).toEqual(expect.arrayContaining(blocked.holds));
  expect(recovered.admissions).toEqual(expect.arrayContaining(blocked.admissions));
  expect(
    f.db.sqlite
      .query("SELECT encrypted_payload,state FROM v2_upload_sessions WHERE id=?")
      .get(f.target.session.uploadSession),
  ).toEqual({ encrypted_payload: upload.encrypted_payload, state: "finalized" });
  expect(
    new Uint8Array(
      await new Response(
        (await f.service().content(f.actor.ownerId, f.workspaceId, f.target.session.fileId)).body,
      ).arrayBuffer(),
    ),
  ).toEqual(f.source);
  expect(await f.complete(f.target, 1)).toMatchObject({ status: "uploaded" });
  expect(f.calls).toEqual({ probe: 3, stop: 3 });
  expect(
    new Uint8Array(
      await new Response(
        (await f.service().content(f.actor.ownerId, f.workspaceId, f.peer.session.fileId)).body,
      ).arrayBuffer(),
    ),
  ).toEqual(f.peerSource);
});

async function seal(f: Awaited<ReturnType<typeof setup>>, hash = f.target.manifest.contentHash) {
  expect(
    await createV2FilesRepository(f.core).recordOriginalDigest(
      f.actor,
      f.target.session.uploadSession,
      1,
      hash,
    ),
  ).toBe(true);
  return (
    f.db.sqlite
      .query("SELECT encrypted_payload FROM v2_upload_sessions WHERE id=?")
      .get(f.target.session.uploadSession) as { encrypted_payload: string }
  ).encrypted_payload;
}

test.each(["customer", "lawyer"] as const)(
  "%s digest-only upload resumes without replacing its receipt or source",
  async (accountType) => {
    const f = await setup();
    await saveAccountType(f.db.binding, f.actor.ownerId, accountType);
    const payload = await seal(f);
    const before = f.stored();
    expect(await f.complete(f.target)).toMatchObject({ status: "uploaded" });
    expect(f.calls).toEqual({ probe: 1, stop: 1 });
    expect(f.stored().parts).toEqual(before.parts);
    expect(f.stored().objects).toEqual(before.objects);
    expect(
      f.db.sqlite
        .query("SELECT encrypted_payload FROM v2_upload_sessions WHERE id=?")
        .get(f.target.session.uploadSession),
    ).toEqual({ encrypted_payload: payload });
  },
);

for (const invalid of [
  "wrong-hash",
  "malformed",
  "expired",
  "revision",
  "deleted",
  "consent",
  "file-consent",
  "owner",
] as const)
  test(`sealed-session recovery rejects ${invalid} before native dispatch`, async () => {
    const f = await setup();
    await seal(f, invalid === "wrong-hash" ? "0".repeat(64) : undefined);
    const uploadId = f.target.session.uploadSession,
      fileId = f.target.session.fileId;
    if (invalid === "malformed")
      f.db.sqlite
        .query("UPDATE v2_upload_sessions SET encrypted_payload='invalid' WHERE id=?")
        .run(uploadId);
    if (invalid === "expired")
      f.db.sqlite
        .query("UPDATE v2_upload_sessions SET expires_at=? WHERE id=?")
        .run(f.actor.now, uploadId);
    if (invalid === "revision")
      f.db.sqlite
        .query("UPDATE v2_upload_sessions SET revision=revision+1 WHERE id=?")
        .run(uploadId);
    if (invalid === "deleted")
      f.db.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('file',?,?)")
        .run(fileId, f.actor.now);
    if (invalid === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    if (invalid === "file-consent")
      f.db.sqlite.query("UPDATE v2_consents SET version='old' WHERE file_id=?").run(fileId);
    if (invalid === "owner")
      f.db.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
        .run(f.actor.ownerId, f.actor.now);
    const before = f.stored();
    await expect(f.complete(f.target)).rejects.toThrow();
    expect(f.calls.probe).toBe(0);
    expect(f.stored().parts).toEqual(before.parts);
    expect(f.stored().objects).toEqual(before.objects);
    expect(f.stored().sessions).toEqual(before.sessions);
    expect(
      f.db.sqlite.query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?").get(fileId),
    ).toEqual({ manifest_snapshot_id: null });
  });

for (const boundary of ["context", "native"] as const)
  test(`sealed-session recovery freezes exact ciphertext across ${boundary}`, async () => {
    const f = await setup();
    const original = await seal(f);
    const replacement = await f.core.encrypt(
      "v2_upload_sessions",
      f.target.session.uploadSession,
      f.actor.ownerId,
      1,
      { contentHash: f.target.manifest.contentHash },
    );
    expect(replacement).not.toBe(original);
    const swap = () => {
      f.db.sqlite
        .query("UPDATE v2_upload_sessions SET encrypted_payload=? WHERE id=?")
        .run(replacement, f.target.session.uploadSession);
    };
    if (boundary === "context") {
      const decrypt = f.core.decrypt;
      let changed = false;
      f.core.decrypt = new Proxy(decrypt, {
        async apply(target, receiver, args) {
          const value = await Reflect.apply(target, receiver, args);
          if (!changed && args[0] === "v2_upload_sessions") {
            changed = true;
            swap();
          }
          return value;
        },
      });
    } else
      f.onProbe(async () => {
        swap();
      });
    await expect(f.complete(f.target)).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.calls.probe).toBe(boundary === "context" ? 0 : 1);
    expect(
      f.db.sqlite
        .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
        .get(f.target.session.fileId),
    ).toEqual({ manifest_snapshot_id: null });
    expect(
      f.db.sqlite
        .query("SELECT state,encrypted_payload FROM v2_upload_sessions WHERE id=?")
        .get(f.target.session.uploadSession),
    ).toEqual({ state: "open", encrypted_payload: replacement });
  });

for (const refusal of [false, true])
  test(`sealed-source final probe fence rejects ciphertext replacement after authorization (refusal=${refusal})`, async () => {
    const f = await setup();
    await seal(f);
    if (refusal) f.refuseProbe();
    const replacement = await f.core.encrypt(
      "v2_upload_sessions",
      f.target.session.uploadSession,
      f.actor.ownerId,
      1,
      { contentHash: f.target.manifest.contentHash },
    );
    const statement = f.core.statement;
    let changed = false;
    f.core.statement = (sql, values) => {
      if (!changed && sql.includes("SELECT ?,w.owner_id,j.id,j.target_revision")) {
        changed = true;
        f.db.sqlite
          .query("UPDATE v2_upload_sessions SET encrypted_payload=? WHERE id=?")
          .run(replacement, f.target.session.uploadSession);
      }
      return statement(sql, values);
    };
    await expect(f.complete(f.target)).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(changed).toBe(true);
    expect(f.calls.probe).toBe(1);
    const metadata = await createV2FilesRepository(f.core).metadata(
      f.actor,
      f.target.session.fileId,
    );
    expect(metadata?.manifestSnapshotId).toBeNull();
    expect(metadata?.uploadRejection).toBeUndefined();
  });

test("a genuine re-probe refusal persists its P53 metadata without replacing the sealed original", async () => {
  const f = await setup();
  const payload = await seal(f);
  const before = f.stored();
  f.refuseProbe();
  await expect(f.complete(f.target)).rejects.toBeInstanceOf(DefinitiveFileRejection);
  expect(
    (await createV2FilesRepository(f.core).metadata(f.actor, f.target.session.fileId))
      ?.uploadRejection,
  ).toBe("FILE_REJECTED");
  expect(
    f.db.sqlite
      .query("SELECT state,encrypted_payload FROM v2_upload_sessions WHERE id=?")
      .get(f.target.session.uploadSession),
  ).toEqual({ state: "open", encrypted_payload: payload });
  expect(f.stored().parts).toEqual(before.parts);
  expect(f.stored().objects).toEqual(before.objects);
  expect(f.stored().reservations).toEqual(before.reservations);
  await expect(f.complete(f.target)).rejects.toBeInstanceOf(DefinitiveFileRejection);
  expect(f.calls.probe).toBe(1);
});

test("sealed-source rejection also keeps the P53 exact metadata publication fence", async () => {
  const f = await setup();
  await seal(f);
  f.refuseProbe();
  const encrypt = f.core.encrypt;
  f.core.encrypt = async (...args: Parameters<typeof encrypt>) => {
    const payload = await encrypt(...args);
    if (args[0] === "v2_files") {
      const other = await encrypt(args[0], args[1], args[2], args[3], {
        name: "changed.txt",
        declaredMediaType: "text/plain",
        probe: null,
        contentHash: f.target.manifest.contentHash,
      });
      f.db.sqlite
        .query("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
        .run(other, f.target.session.fileId);
    }
    return payload;
  };
  await expect(f.complete(f.target)).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    (await createV2FilesRepository(f.core).metadata(f.actor, f.target.session.fileId))
      ?.uploadRejection,
  ).toBeUndefined();
  expect(f.calls.probe).toBe(1);
});

for (const corruption of ["object", "part-receipt", "manifest"] as const)
  test(`same digest never bypasses original integrity: ${corruption}`, async () => {
    const f = await setup();
    await seal(f);
    if (corruption === "object") {
      const row = f.db.sqlite
        .query(
          "SELECT b.object_key FROM v2_upload_parts p JOIN v2_blobs b ON b.id=p.blob_id WHERE p.upload_id=?",
        )
        .get(f.target.session.uploadSession) as { object_key: string };
      const bytes = f.bucket.objects.get(row.object_key);
      if (!bytes) throw new Error("Synthetic original missing");
      const last = bytes[bytes.length - 1];
      if (last === undefined) throw new Error("Synthetic original is empty");
      bytes[bytes.length - 1] = last ^ 1;
    }
    if (corruption === "part-receipt")
      f.db.sqlite
        .query("UPDATE v2_upload_parts SET encrypted_payload='invalid' WHERE upload_id=?")
        .run(f.target.session.uploadSession);
    if (corruption === "manifest") {
      const part = f.target.manifest.parts[0];
      if (!part) throw new Error("Synthetic manifest part missing");
      part.contentHash = "0".repeat(64);
    }
    const before = f.stored();
    await expect(f.complete(f.target)).rejects.toThrow();
    expect(f.stored().parts).toEqual(before.parts);
    expect(f.stored().objects).toEqual(before.objects);
    expect(f.stored().sessions).toEqual(before.sessions);
    expect(
      f.db.sqlite
        .query("SELECT manifest_snapshot_id FROM v2_files WHERE id=?")
        .get(f.target.session.fileId),
    ).toEqual({ manifest_snapshot_id: null });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: 0 });
  });
