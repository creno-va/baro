import { expect, test } from "bun:test";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createAssetProcessingRuntime } from "../src/server/modules/budget/asset-runtime";
import { decryptSanitizedFrame } from "../src/server/modules/file-processing/sanitized-binary";
import { digest } from "../src/server/modules/files/binary";
import type { PrivateBucket } from "../src/server/modules/files/service";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import { createAssetProcessingAdmission } from "../src/server/runtime/asset-admission";
import { countD1Calls } from "./helpers/d1-call-count";
import { fixture } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

// Only native codec output and R2 IO are local adapters. Admission, encryption,
// actual runtime factory, source decoding, physical ledger and publication run.
function fixed(length: number) {
  let observed = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      observed += bytes.length;
      if (observed > length) throw new Error("Synthetic fixed stream overflow");
      controller.enqueue(bytes);
    },
    flush() {
      if (observed !== length) throw new Error("Synthetic incomplete fixed stream");
    },
  });
}

async function setup(wrapDatabase: (database: D1Database) => D1Database = (db) => db) {
  const f = await fixture();
  f.actor.now = new Date().toISOString();
  const clock = () => new Date().toISOString();
  const bucket = {
    ...f.bucket.port,
    put: async (key: string, body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>) =>
      f.bucket.port.put(
        key,
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()),
      ),
  } as PrivateBucket;
  const profileId = crypto.randomUUID();
  expect(await createV2LawyersRepository(f.core).createProfile(f.actor, profileId)).toBe(true);
  const original = new Uint8Array(
    await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer(),
  );
  const assets = createLawyerAssetsService(f.core, {
    environment: "preview",
    bucket,
    clock,
    testOnlyUnmeteredStorage: true,
    fixedLengthStream: fixed,
  });
  const reserved = await assets.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    {
      purpose: "profile_photo",
      name: "synthetic-profile.jpg",
      byteLength: original.length,
      mediaType: "image/jpeg",
    },
    "portfolio",
  );
  await assets.upload(
    f.actor.ownerId,
    reserved.assetId,
    1,
    original.length,
    new Response(original).body,
  );
  // Authenticated synthetic inventory for the original created by the offline
  // uploader. The derived output must acquire its own new physical capability.
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,inventory_hash,state,writer_state,created_at) SELECT id,'preview',?,object_key,cipher_bytes,?,'held','stopped',? FROM v2_blobs WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
    )
    .run(f.actor.ownerId, "e".repeat(64), clock(), reserved.assetId);
  f.core.applicationCostLimitsEnabled = false;
  let nativeCalls = 0,
    stops = 0;
  let beforeNativeResponse = () => {};
  const env = {
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    DB: wrapDatabase(f.db.binding),
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: bucket,
    ASSET_PROCESSING: {},
    FILE_PROCESSOR: {
      idFromName: (id: string) => id,
      get: () => ({
        stopProcessing: async () => {
          stops++;
        },
        fetch: async (request: Request) => {
          nativeCalls++;
          expect(new Uint8Array(await request.arrayBuffer())).toEqual(original);
          beforeNativeResponse();
          const encoded = Buffer.from(original).toString("base64");
          return new Response(
            `${[
              {
                type: "sanitized_manifest",
                value: {
                  version: 1,
                  passes: 2,
                  probe: {
                    category: "image",
                    format: "jpeg",
                    byteLength: original.length,
                    width: 720,
                    height: 420,
                  },
                  format: "jpeg",
                  byteLength: original.length,
                  contentHash: await digest(original),
                  chunkCount: 1,
                },
              },
              { type: "sanitized_chunk", pass: 0, index: 0, data: encoded },
              { type: "sanitized_chunk", pass: 1, index: 0, data: encoded },
              { type: "complete" },
            ]
              .map((record) => JSON.stringify(record))
              .join("\n")}\n`,
            { headers: { "content-type": "application/x-ndjson" } },
          );
        },
      }),
    },
  } as unknown as Env;
  const operation = f.db.sqlite
    .query(
      "SELECT r.operation_id FROM v2_storage_reservations r JOIN v2_assets a ON a.id=r.entity_id WHERE a.id=?",
    )
    .get(reserved.assetId) as { operation_id: string };
  expect(
    await createAssetProcessingAdmission(f.core, env, {}, clock).enqueueProcessing?.({
      ownerId: f.actor.ownerId,
      profileId,
      assetId: reserved.assetId,
      assetRevision: 2,
      operationId: operation.operation_id,
    }),
  ).toBe(true);
  const job = f.db.sqlite
    .query("SELECT id,runtime_instance_id FROM v2_jobs WHERE target_id=?")
    .get(reserved.assetId) as { id: string; runtime_instance_id: string };
  const params = {
    ownerId: f.actor.ownerId,
    profileId,
    assetId: reserved.assetId,
    assetRevision: 2,
    jobId: job.id,
  };
  const runtime = await createAssetProcessingRuntime(env, params, job.runtime_instance_id);
  return {
    ...f,
    runtime,
    params,
    original,
    nativeCalls: () => nativeCalls,
    stops: () => stops,
    beforeNativeResponse: (hook: () => void) => {
      beforeNativeResponse = hook;
    },
  };
}

async function withFixedLength(run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream");
  Object.defineProperty(globalThis, "FixedLengthStream", {
    configurable: true,
    value: function SyntheticFixedLengthStream(length: number) {
      return fixed(length);
    },
  });
  try {
    await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "FixedLengthStream", descriptor);
    else Reflect.deleteProperty(globalThis, "FixedLengthStream");
  }
}

test("actual asset runtime without cost metadata writes one bounded physical derivative and retains readable bytes", () =>
  withFixedLength(async () => {
    const f = await setup();
    expect(await f.runtime.run(new AbortController().signal)).toMatchObject({
      status: "ready",
      revision: 3,
    });
    expect(f.nativeCalls()).toBe(1);
    expect(f.stops()).toBe(1);
    expect(f.bucket.calls.put).toBe(2);
    const output = f.db.sqlite
      .query(
        "SELECT b.id,b.cipher_bytes,b.state,p.writer_state,p.expected_cipher_bytes,p.maximum_cipher_bytes FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.visibility='staging'",
      )
      .get() as {
      id: string;
      cipher_bytes: number;
      state: string;
      writer_state: string;
      expected_cipher_bytes: number;
      maximum_cipher_bytes: number;
    };
    expect(output).toMatchObject({ state: "stored", writer_state: "stopped" });
    expect(output.expected_cipher_bytes).toBe(output.cipher_bytes);
    expect(output.maximum_cipher_bytes).toBe(output.cipher_bytes);
    expect(f.bucket.objects.get(`private/${output.id}`)?.length).toBe(output.cipher_bytes);
    const bytes = f.bucket.objects.get(`private/${output.id}`);
    const source = f.db.sqlite
      .query("SELECT source_blob_id FROM v2_blobs WHERE id=?")
      .get(output.id) as { source_blob_id: string };
    if (!bytes) throw new Error("Actual encrypted derivative missing");
    expect(
      await decryptSanitizedFrame(
        f.core.cipher,
        {
          environment: "preview",
          ownerId: f.params.ownerId,
          profileId: f.params.profileId,
          assetId: f.params.assetId,
          assetRevision: 2,
          sourceBlobId: source.source_blob_id,
          blobId: output.id,
        },
        bytes,
        { index: 0, byteLength: f.original.length, contentHash: await digest(f.original) },
      ),
    ).toEqual(f.original);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
    expect(
      f.db.sqlite
        .query(
          "SELECT service,state,transport FROM v2_execution_admissions ORDER BY created_at,attempt_id",
        )
        .all(),
    ).toEqual([
      { service: "requests", state: "final", transport: "response" },
      { service: "container", state: "final", transport: "response" },
      { service: "requests", state: "final", transport: "response" },
    ]);
    const calls = { ...f.bucket.calls };
    expect(await f.runtime.run(new AbortController().signal)).toMatchObject({ status: "ready" });
    expect(f.bucket.calls).toEqual(calls);
  }));

test("physical capacity exhaustion rejects the derivative atomically before PUT", () =>
  withFixedLength(async () => {
    const f = await setup();
    f.db.sqlite
      .query(
        "UPDATE v2_physical_storage_capacity SET capacity_bytes=held_bytes WHERE environment='preview'",
      )
      .run();
    await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(f.bucket.calls.put).toBe(1);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_physical_blob_bindings").get()).toEqual({
      n: 1,
    });
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE visibility='staging'").get(),
    ).toEqual({ n: 0 });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_blobs WHERE visibility='private' AND state='stored'")
        .get(),
    ).toEqual({ n: 1 });
  }));

for (const outcome of ["unknown", "wrong-receipt"] as const) {
  test(`actual derivative ${outcome} retains physical obligation and cannot repeat IO`, () =>
    withFixedLength(async () => {
      const f = await setup();
      if (outcome === "unknown") f.bucket.setPutAmbiguous(true);
      else f.bucket.setWrongReceipt(true);
      await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
        code: outcome === "unknown" ? "FILE_PROCESSING_FAILED" : "STORAGE_UNAVAILABLE",
      });
      const derivative = f.db.sqlite
        .query(
          "SELECT b.state,p.writer_state,p.state physical_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.visibility='staging'",
        )
        .get();
      expect(derivative).toEqual({
        state: "deleting",
        writer_state: "running",
        physical_state: "held",
      });
      const admission = f.db.sqlite
        .query(
          "SELECT state,transport FROM v2_execution_admissions WHERE json_extract(payload_json,'$.plan.quantities[0].sku')='r2_class_a_requests'",
        )
        .get();
      expect(admission).toEqual({
        state: outcome === "unknown" ? "unknown" : "final",
        transport: outcome === "unknown" ? "unknown" : "response",
      });
      const calls = { ...f.bucket.calls };
      const native = f.nativeCalls();
      await expect(f.runtime.run(new AbortController().signal)).rejects.toThrow();
      expect(f.bucket.calls).toEqual(calls);
      expect(f.nativeCalls()).toBe(native);
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_assets WHERE state='ready'").get(),
      ).toEqual({ n: 0 });
    }));
}

test("writer-stop persistence failure preserves independent cleanup and the real response", () =>
  withFixedLength(async () => {
    const f = await setup();
    f.db.sqlite.exec(`CREATE TEMP TRIGGER synthetic_stop_failure BEFORE UPDATE OF writer_state ON v2_physical_blob_bindings
      WHEN NEW.writer_state='stopped' AND OLD.writer_state='running' BEGIN SELECT RAISE(ABORT,'synthetic stop failure'); END`);
    await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    const derivative = f.db.sqlite
      .query(
        "SELECT b.id,b.state,p.writer_state,p.state physical_state FROM v2_blobs b JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.visibility='staging'",
      )
      .get() as { id: string };
    expect(derivative).toMatchObject({
      state: "deleting",
      writer_state: "running",
      physical_state: "held",
    });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_deletion_targets WHERE kind='blob' AND target_id=?")
        .get(derivative.id),
    ).toEqual({ n: 1 });
    expect(
      f.db.sqlite
        .query(
          "SELECT state,transport FROM v2_execution_admissions WHERE json_extract(payload_json,'$.plan.quantities[0].sku')='r2_class_a_requests'",
        )
        .get(),
    ).toEqual({ state: "final", transport: "response" });
    expect(f.bucket.calls.put).toBe(2);
    expect(f.bucket.objects.has(`private/${derivative.id}`)).toBe(true);
  }));

test("asset runtime preserves current/source boundaries with guarded dispatch and isolated observations", () =>
  withFixedLength(async () => {
    let measured!: ReturnType<typeof countD1Calls>;
    const f = await setup((database) => {
      measured = countD1Calls(database);
      return measured.binding;
    });
    let currentReads = 0,
      originalSnapshotReads = 0,
      separateConsentReads = 0,
      dispatches = 0,
      dispatchReadbacks = 0,
      maintenancePolicyCalls = 0,
      monthBucketCalls = 0;
    measured.after((statements) => {
      for (const sql of statements) {
        if (sql.includes("original.encrypted_payload AS source_payload")) {
          currentReads++;
          expect(sql).toContain("EXISTS(SELECT 1 FROM user_consents consent");
          expect(sql).toContain("consent.over_14_confirmed=1");
        } else if (sql.includes("reserved_principal.owner_id=a.owner_id")) originalSnapshotReads++;
        else if (sql.includes("user_consents")) separateConsentReads++;
        if (sql.startsWith("UPDATE v2_execution_admissions SET state='dispatched'")) dispatches++;
        if (sql.startsWith("SELECT a.plan_id,a.digest,a.payload_json,a.invocation_id,a.attempt"))
          dispatchReadbacks++;
        if (
          sql.startsWith("INSERT INTO v2_cost_execution_policy(environment,limits_enabled) VALUES")
        ) {
          expect(statements).toHaveLength(1);
          maintenancePolicyCalls++;
        }
        if (sql.startsWith("INSERT INTO v2_monthly_budget")) {
          expect(statements).toHaveLength(1);
          monthBucketCalls++;
        }
      }
    });
    expect(await f.runtime.run(new AbortController().signal)).toMatchObject({ status: "ready" });
    // Same factory + one-chunk JPEG baseline: 173 calls / 209 statements.
    // PR269 combined current-source reads to 111/147. The five original source
    // boundaries combine 4 further reads into 1 each: 96/132, without cache.
    // Atomic transport receipt updates remove three further roundtrips: 93/129.
    // Three guarded dispatches each remove one call / three statements (90/120).
    // Isolating the optional month insert from required policy adds one call,
    // with the same two statements. All three fresh dispatch readbacks remain.
    expect(measured.work).toEqual({ calls: 91, statements: 120 });
    expect({ dispatches, dispatchReadbacks, maintenancePolicyCalls, monthBucketCalls }).toEqual({
      dispatches: 3,
      dispatchReadbacks: 3,
      maintenancePolicyCalls: 1,
      monthBucketCalls: 1,
    });
    expect(currentReads).toBe(31);
    expect(originalSnapshotReads).toBe(5);
    expect(separateConsentReads).toBe(3);
    expect(f.nativeCalls()).toBe(1);
    expect(f.bucket.calls.put).toBe(2);
    const stageTimings = f.runtime.timings();
    expect(stageTimings.map(({ stage }) => stage)).toEqual([
      "initialization",
      "lease_acquisition",
      "source_authorization",
      "original_open",
      "processor_roundtrip",
      "output_preparation",
      "output_stream_put",
      "publication",
      "cleanup",
    ]);
    for (const timing of stageTimings) {
      expect(Object.keys(timing).sort()).toEqual(["durationMs", "stage"]);
      expect(Number.isSafeInteger(timing.durationMs)).toBe(true);
      expect(timing.durationMs).toBeGreaterThanOrEqual(0);
    }
  }));

for (const boundary of [1, 2, 3, 4, 5])
  test(`original source boundary ${boundary} rechecks consent before IO or plaintext yield`, () =>
    withFixedLength(async () => {
      let measured!: ReturnType<typeof countD1Calls>;
      const f = await setup((database) => {
        measured = countD1Calls(database);
        return measured.binding;
      });
      let reads = 0;
      measured.before((statements) => {
        if (!statements.some((sql) => sql.includes("reserved_principal.owner_id=a.owner_id")))
          return;
        if (++reads === boundary)
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.params.ownerId);
      });
      await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
        code: boundary <= 3 ? "STORAGE_UNAVAILABLE" : "FILE_PROCESSING_FAILED",
      });
      expect(reads).toBe(boundary);
      expect(f.bucket.calls.get).toBe(boundary <= 2 ? 0 : 1);
      expect(f.nativeCalls()).toBe(boundary <= 3 ? 0 : 1);
      expect(f.bucket.calls.put).toBe(1);
    }));

for (const mutation of [
  "terms",
  "privacy",
  "ai_notice",
  "over14",
  "owner",
  "profile",
  "revision",
  "state",
  "account_deleted",
  "profile_deleted",
  "asset_deleted",
  "source_deleted",
  "source_hash",
  "source_payload",
  "reservation_released",
  "reservation_bytes",
] as const)
  test(`final original source snapshot rejects ${mutation} before decrypted bytes leave the worker`, () =>
    withFixedLength(async () => {
      let measured!: ReturnType<typeof countD1Calls>;
      const f = await setup((database) => {
        measured = countD1Calls(database);
        return measured.binding;
      });
      const foreign = await seedTestSession(f.db, { consent: true });
      const foreignProfile = crypto.randomUUID();
      expect(
        await createV2LawyersRepository(f.core).createProfile(
          { ownerId: foreign.userId, now: f.actor.now },
          foreignProfile,
        ),
      ).toBe(true);
      let reads = 0;
      measured.before((statements) => {
        if (
          !statements.some((sql) => sql.includes("reserved_principal.owner_id=a.owner_id")) ||
          ++reads !== 5
        )
          return;
        if (["terms", "privacy", "ai_notice"].includes(mutation)) {
          const column =
            mutation === "terms"
              ? "terms_version"
              : mutation === "privacy"
                ? "privacy_version"
                : "ai_notice_version";
          f.db.sqlite
            .query(`UPDATE user_consents SET ${column}='stale' WHERE user_id=?`)
            .run(f.params.ownerId);
        } else if (mutation === "over14")
          f.db.sqlite
            .query("UPDATE user_consents SET over_14_confirmed=0 WHERE user_id=?")
            .run(f.params.ownerId);
        else if (mutation === "owner")
          f.db.sqlite
            .query("UPDATE v2_assets SET owner_id=? WHERE id=?")
            .run(foreign.userId, f.params.assetId);
        else if (mutation === "profile")
          f.db.sqlite
            .query("UPDATE v2_assets SET profile_id=? WHERE id=?")
            .run(foreignProfile, f.params.assetId);
        else if (mutation === "revision")
          f.db.sqlite
            .query("UPDATE v2_assets SET revision=revision+1 WHERE id=?")
            .run(f.params.assetId);
        else if (mutation === "state")
          f.db.sqlite.query("UPDATE v2_assets SET state='failed' WHERE id=?").run(f.params.assetId);
        else if (mutation === "source_deleted")
          f.db.sqlite
            .query(
              "UPDATE v2_blobs SET state='deleting' WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
            )
            .run(f.params.assetId);
        else if (mutation === "source_hash")
          f.db.sqlite
            .query(
              "UPDATE v2_blobs SET cipher_hash=? WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
            )
            .run("0".repeat(64), f.params.assetId);
        else if (mutation === "source_payload")
          f.db.sqlite
            .query(
              "UPDATE v2_blobs SET encrypted_payload='changed-synthetic-ciphertext' WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
            )
            .run(f.params.assetId);
        else if (mutation === "reservation_released")
          f.db.sqlite
            .query(
              "UPDATE v2_storage_reservations SET state='released' WHERE id=(SELECT reservation_id FROM v2_blobs WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?))",
            )
            .run(f.params.assetId);
        else if (mutation === "reservation_bytes")
          f.db.sqlite
            .query(
              "UPDATE v2_storage_reservations SET byte_length=byte_length+1 WHERE id=(SELECT reservation_id FROM v2_blobs WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?))",
            )
            .run(f.params.assetId);
        else
          f.db.sqlite
            .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
            .run(
              mutation === "account_deleted"
                ? "account"
                : mutation === "profile_deleted"
                  ? "profile"
                  : "asset",
              mutation === "account_deleted"
                ? f.params.ownerId
                : mutation === "profile_deleted"
                  ? f.params.profileId
                  : f.params.assetId,
              new Date().toISOString(),
            );
      });
      await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
        code: "FILE_PROCESSING_FAILED",
      });
      expect(reads).toBe(5);
      expect(f.nativeCalls()).toBe(1);
      expect(f.bucket.calls.put).toBe(1);
    }));

for (const mutation of ["lease_expired", "lease_fenced"] as const)
  test(`original source keeps its final job authorization after ${mutation}`, () =>
    withFixedLength(async () => {
      let measured!: ReturnType<typeof countD1Calls>;
      const f = await setup((database) => {
        measured = countD1Calls(database);
        return measured.binding;
      });
      let sourceReads = 0,
        changed = false;
      measured.before((statements) => {
        if (statements.some((sql) => sql.includes("reserved_principal.owner_id=a.owner_id")))
          sourceReads++;
        if (
          changed ||
          sourceReads !== 4 ||
          !statements.some((sql) => sql.includes("original.encrypted_payload AS source_payload"))
        )
          return;
        changed = true;
        if (mutation === "lease_expired")
          f.db.sqlite
            .query("UPDATE v2_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?")
            .run(f.params.jobId);
        else
          f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.params.jobId);
      });
      await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
        code: "FILE_PROCESSING_FAILED",
      });
      expect(changed).toBe(true);
      expect(sourceReads).toBe(4);
      expect(f.bucket.calls.put).toBe(1);
    }));

for (const mutation of [
  "consent_removed",
  "terms",
  "privacy",
  "ai_notice",
  "account_deleted",
  "profile_deleted",
  "asset_deleted",
  "source_deleted",
  "lease_expired",
  "lease_fenced",
] as const) {
  test(`atomic asset read denies ${mutation} immediately before its first current-source query`, () =>
    withFixedLength(async () => {
      let measured!: ReturnType<typeof countD1Calls>;
      const f = await setup((database) => {
        measured = countD1Calls(database);
        return measured.binding;
      });
      let changed = false;
      measured.before((statements) => {
        if (
          changed ||
          !statements.some((sql) => sql.includes("original.encrypted_payload AS source_payload"))
        )
          return;
        changed = true;
        if (mutation === "consent_removed")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.params.ownerId);
        else if (mutation === "terms")
          f.db.sqlite
            .query("UPDATE user_consents SET terms_version='revoked' WHERE user_id=?")
            .run(f.params.ownerId);
        else if (mutation === "privacy")
          f.db.sqlite
            .query("UPDATE user_consents SET privacy_version='revoked' WHERE user_id=?")
            .run(f.params.ownerId);
        else if (mutation === "ai_notice")
          f.db.sqlite
            .query("UPDATE user_consents SET ai_notice_version='revoked' WHERE user_id=?")
            .run(f.params.ownerId);
        else if (mutation === "source_deleted")
          f.db.sqlite
            .query(
              "UPDATE v2_blobs SET state='deleting' WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
            )
            .run(f.params.assetId);
        else if (mutation === "lease_expired")
          f.db.sqlite
            .query("UPDATE v2_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?")
            .run(f.params.jobId);
        else if (mutation === "lease_fenced")
          f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(f.params.jobId);
        else
          f.db.sqlite
            .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
            .run(
              mutation === "account_deleted"
                ? "account"
                : mutation === "profile_deleted"
                  ? "profile"
                  : "asset",
              mutation === "account_deleted"
                ? f.params.ownerId
                : mutation === "profile_deleted"
                  ? f.params.profileId
                  : f.params.assetId,
              new Date().toISOString(),
            );
      });
      await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
        code: "STALE_REVISION",
      });
      expect(changed).toBe(true);
      expect(f.nativeCalls()).toBe(0);
      expect(f.bucket.calls.get).toBe(0);
      expect(f.bucket.calls.put).toBe(1);
    }));
}

test("consent revoked after native input is consumed still rejects output before its PUT", () =>
  withFixedLength(async () => {
    const f = await setup();
    f.beforeNativeResponse(() => {
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.params.ownerId);
    });
    await expect(f.runtime.run(new AbortController().signal)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(f.nativeCalls()).toBe(1);
    expect(f.stops()).toBe(1);
    expect(f.bucket.calls.put).toBe(1);
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE visibility='staging'").get(),
    ).toEqual({ n: 0 });
  }));
