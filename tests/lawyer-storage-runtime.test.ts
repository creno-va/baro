import { afterEach, expect, setSystemTime, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import { createLawyerPublicationService } from "../src/server/modules/lawyers/publication";
import {
  createLawyerStorageBudget,
  lawyerStorageRequestCore,
  maximumAssetCipherBytes,
} from "../src/server/modules/lawyers/storage-runtime";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { loseD1Response } from "./helpers/d1-response-loss";
import { measureD1Work } from "./helpers/d1-work";
import { publicationFixture } from "./helpers/lawyer-publication";
import { copySyntheticD1 } from "./helpers/native-d1";
import {
  fixture as capacityFixture,
  HASH,
  NOW,
  projection,
  ready,
  verifier,
} from "./helpers/storage-capacity";

afterEach(() => setSystemTime());
export function syntheticFixed(length: number) {
  let written = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(value, c) {
      written += value.length;
      if (written > length) throw new Error("Synthetic overflow");
      c.enqueue(value);
    },
    flush() {
      if (written !== length) throw new Error("Synthetic truncation");
    },
  });
}
export async function originalRuntimeFixture() {
  setSystemTime(new Date(NOW));
  const f = await ready({ getLimit: 100, headLimit: 100, deleteLimit: 100 });
  const profileId = crypto.randomUUID();
  await createV2LawyersRepository(f.core).createProfile(f.actor, profileId);
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
    .run(`account-type:${f.actor.ownerId}`);
  let unknown = false;
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      const value = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, value);
      if (unknown) throw new Error("Synthetic unknown PUT");
      return { key, size: value.length };
    },
  };
  const core = lawyerStorageRequestCore(f.core, false);
  const costs = createLawyerStorageBudget(core, "preview", f.actor.ownerId, () => NOW);
  const service = createLawyerAssetsService(core, {
    environment: "preview",
    clock: () => NOW,
    bucket: bucket as never,
    paidStorage: () => costs,
    fixedLengthStream: syntheticFixed,
  });
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const reserved = await service.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    {
      purpose: "profile_photo",
      name: "synthetic.jpg",
      byteLength: bytes.length,
      mediaType: "image/jpeg",
    },
    "portfolio",
  );
  return {
    ...f,
    core,
    costs,
    profileId,
    service,
    reserved,
    bytes,
    objects,
    bucket,
    setUnknown() {
      unknown = true;
    },
  };
}
test("server lawyer original bounds reserve full capacity and stop the exact writer without erasing unknown billing", async () => {
  const f = await originalRuntimeFixture();
  const result = await f.service.upload(
    f.actor.ownerId,
    f.reserved.assetId,
    1,
    f.bytes.length,
    new Response(f.bytes).body,
  );
  expect(result.revision).toBe(2);
  const binding = f.db.sqlite
    .query(
      "SELECT writer_state,state,maximum_cipher_bytes,expected_cipher_bytes FROM v2_physical_blob_bindings",
    )
    .get() as { maximum_cipher_bytes: number; expected_cipher_bytes: number };
  expect(binding).toMatchObject({ writer_state: "stopped", state: "held" });
  expect(binding.maximum_cipher_bytes).toBe(binding.expected_cipher_bytes);
  expect(binding.maximum_cipher_bytes).toBeLessThanOrEqual(maximumAssetCipherBytes(f.bytes.length));
  expect(f.db.sqlite.query("SELECT state FROM v2_cost_attempts").get()).toMatchObject({
    state: "reserved",
  });
  expect(f.objects.size).toBe(1);
});
test("unknown lawyer PUT keeps physical writer and conservative cost, journalling cleanup", async () => {
  const f = await originalRuntimeFixture();
  f.setUnknown();
  await expect(
    f.service.upload(
      f.actor.ownerId,
      f.reserved.assetId,
      1,
      f.bytes.length,
      new Response(f.bytes).body,
    ),
  ).rejects.toThrow();
  expect(
    f.db.sqlite.query("SELECT writer_state,state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ writer_state: "running", state: "held" });
  expect(f.db.sqlite.query("SELECT state FROM v2_cost_attempts").get()).toEqual({
    state: "reserved",
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
});
test("missing capacity proof prevents lawyer original body consumption and financial dispatch", async () => {
  const f = await originalRuntimeFixture();
  f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
  let consumed = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        consumed = true;
        c.close();
      },
    },
    { highWaterMark: 0 },
  );
  await expect(
    f.service.upload(f.actor.ownerId, f.reserved.assetId, 1, 4, body),
  ).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
  expect(consumed).toBe(false);
  expect(f.objects.size).toBe(0);
});

for (const stage of ["start", "stop"] as const)
  test(`lawyer writer ${stage} response loss preserves exact writer authority and financial hold`, async () => {
    const f = await originalRuntimeFixture();
    const lost = loseD1Response(f.db.binding, (sql) =>
      sql.startsWith(
        `UPDATE v2_physical_blob_bindings SET writer_state='${stage === "start" ? "running" : "stopped"}'`,
      ),
    );
    await expect(
      f.service.upload(f.actor.ownerId, f.reserved.assetId, 1, 4, new Response(f.bytes).body),
    ).rejects.toThrow();
    expect(lost()).toBe(true);
    expect(
      f.db.sqlite.query("SELECT writer_state,state FROM v2_physical_blob_bindings").get(),
    ).toEqual({ writer_state: "stopped", state: "held" });
    expect(f.objects.size).toBe(stage === "start" ? 0 : 1);
    expect(f.db.sqlite.query("SELECT state FROM v2_cost_attempts").get()).toEqual({
      state: "reserved",
    });
  });
async function publicRuntimeFixture() {
  setSystemTime(new Date(NOW));
  const base = await capacityFixture();
  const f = await publicationFixture(base.db);
  // Synthetic upstream bytes are already stored. Import their conservative
  // inventory just as the pre-existing source, never as a billing receipt.
  f.db.sqlite.query("UPDATE v2_blobs SET object_key='private/'||id WHERE id=?").run(f.sourceBlobId);
  expect(await base.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  const capacity = (
    await import("../src/server/db/v2-storage-capacity")
  ).createV2StorageCapacityRepository(base.core, "preview", verifier);
  expect(
    await capacity.bindInventory(
      {
        id: crypto.randomUUID(),
        manifestHash: HASH,
        observedAt: NOW,
        bindings: [
          {
            blobId: f.sourceBlobId,
            ownerId: f.owner.userId,
            objectKey: `private/${f.sourceBlobId}`,
            maximumCipherBytes: f.bytes.length,
            writerState: "stopped",
          },
        ],
      },
      NOW,
    ),
  ).toBe(true);
  expect(
    await capacity.reserveProjection(
      projection(base, { getLimit: 100, headLimit: 100, deleteLimit: 100 }),
      NOW,
    ),
  ).toBe(true);
  const drain = await base.runtime.drain("2026-10", 5, base.ap.id, NOW);
  if (!drain) throw new Error("Synthetic drain missing");
  await base.runtime.putRemoteDrainProof(drain, NOW);
  const remote = {
    ...drain,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  await base.runtime.putRemoteDrainProof(remote, NOW);
  expect(await base.runtime.activate("2026-10", 6, base.ap.id, drain.id, remote.id, NOW)).toBe(
    true,
  );
  return f;
}
test("public copy shares one funded GET/PUT, physical capacity and exact stopped writer", async () => {
  const f = await publicRuntimeFixture();
  const core = lawyerStorageRequestCore(f.core, false),
    costs = createLawyerStorageBudget(core, "preview", f.owner.userId, () => NOW);
  const service = createLawyerPublicationService(core, {
    ...f.deps,
    clock: () => NOW,
    paidStorage: () => costs,
    openSanitized: async (input) => {
      const { approvedReadPermit: _permit, ...source } = input;
      return f.deps.openSanitized(source);
    },
  });
  const result = await service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  expect(
    f.db.sqlite
      .query(
        "SELECT writer_state,state,maximum_cipher_bytes FROM v2_physical_blob_bindings WHERE blob_id=?",
      )
      .get(result.blobId),
  ).toEqual({ writer_state: "stopped", state: "held", maximum_cipher_bytes: f.bytes.length });
  expect(f.db.sqlite.query("SELECT state FROM v2_cost_attempts").get()).toEqual({
    state: "reserved",
  });
  const request = JSON.parse(
    (
      f.db.sqlite.query("SELECT payload_json FROM v2_storage_paid_executions").get() as {
        payload_json: string;
      }
    ).payload_json,
  );
  expect(request.plan.quantities).toEqual(
    expect.arrayContaining([
      { sku: "r2_class_a_requests", maximumQuantity: "1" },
      { sku: "r2_class_b_requests", maximumQuantity: "1" },
    ]),
  );
});

test("native D1 authenticates and bounds original PUT, then funds a scoped public copy with real physical CAS", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic lawyer storage")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["ORIGINAL", "PUBLIC_SMALL", "PUBLIC_LARGE", "UPGRADE"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const original = await originalRuntimeFixture();
    const upgrade = (await mf.getD1Database("UPGRADE")) as unknown as D1Database;
    await copySyntheticD1(upgrade, original.db.sqlite, "0012_directory_index");
    const migration = (await Bun.file("drizzle/0013_lawyer_storage_lookups.sql").text())
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await expect(
      upgrade.batch([
        ...migration.map((sql) => upgrade.prepare(sql)),
        upgrade.prepare("INSERT INTO v2_directory_epoch(id,revision) VALUES(2,0)"),
      ]),
    ).rejects.toThrow();
    expect(
      await upgrade
        .prepare("SELECT name FROM sqlite_master WHERE name='v2_blob_public_source'")
        .first(),
    ).toBeNull();
    expect(
      await upgrade
        .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
        .first<string>("value"),
    ).toBe("0012_directory_index");
    await upgrade.batch(migration.map((sql) => upgrade.prepare(sql)));
    expect(
      await upgrade
        .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
        .first<string>("value"),
    ).toBe("0013_lawyer_storage_lookups");
    const db = (await mf.getD1Database("ORIGINAL")) as unknown as D1Database;
    await copySyntheticD1(db, original.db.sqlite);
    const measured = measureD1Work(db);
    const env = {
      ...testEnvironment(measured.binding),
      APP_ENV: "preview",
      CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
      MONTHLY_BUDGET_CAP_ENABLED: "true",
    } as Env;
    const token = original.db.sqlite
      .query("SELECT token FROM session WHERE user_id=?")
      .get(original.actor.ownerId) as { token: string };
    const api = createLawyersApi({
      dependencies: async (_env, core, ownerId) => ({
        bucket: original.bucket as never,
        paidStorage: () => createLawyerStorageBudget(core, "preview", ownerId, () => NOW),
        fixedLengthStream: syntheticFixed,
      }),
    });
    const response = await api.request(
      `/lawyer/assets/${original.reserved.assetId}/content`,
      {
        method: "PUT",
        headers: {
          cookie: await signedSessionCookie(token.token, env.BETTER_AUTH_SECRET),
          origin: env.BETTER_AUTH_URL,
          "if-match": "1",
          "content-type": "application/octet-stream",
          "content-length": "4",
        },
        body: original.bytes,
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(
      await db
        .prepare("SELECT writer_state FROM v2_physical_blob_bindings")
        .first<string>("writer_state"),
    ).toBe("stopped");
    expect(await db.prepare("SELECT state FROM v2_cost_attempts").first<string>("state")).toBe(
      "reserved",
    );
    const originalWork = { ...measured.work };
    const published = await publicRuntimeFixture();
    const copies = [];
    for (const [bindingName, count] of [
      ["PUBLIC_SMALL", 100],
      ["PUBLIC_LARGE", 10000],
    ] as const) {
      const publicDb = (await mf.getD1Database(bindingName)) as unknown as D1Database;
      await copySyntheticD1(publicDb, published.db.sqlite);
      const numbers = `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${count})`;
      await publicDb
        .prepare(
          `${numbers} INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) SELECT 'history-'||i,id,'synthetic-history','history-'||i,'history-asset-'||i,'lawyer_asset',1,'released',? FROM n CROSS JOIN v2_billing_principals WHERE owner_id=?`,
        )
        .bind(NOW, published.owner.userId)
        .run();
      await publicDb
        .prepare(
          `${numbers} INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,encrypted_payload,created_at,deleted_at) SELECT 'history-'||i,id,'history-'||i,'profile_photo_original','private','deleted','private/history-'||i,1,0,'removed',?,? FROM n CROSS JOIN v2_billing_principals WHERE owner_id=?`,
        )
        .bind(NOW, NOW, published.owner.userId)
        .run();
      const failures: unknown[] = [];
      const publicWork = measureD1Work(publicDb, (error) => failures.push(error));
      const core = lawyerStorageRequestCore(
        createV2Core(publicWork.binding, published.core.cipher),
      );
      const service = createLawyerPublicationService(core, {
        ...published.deps,
        clock: () => NOW,
        paidStorage: (ownerId) => createLawyerStorageBudget(core, "preview", ownerId, () => NOW),
        openSanitized: async (input) => {
          const { approvedReadPermit: _permit, ...source } = input;
          return published.deps.openSanitized(source);
        },
      });
      const copied = await service.copyApprovedAsset(
        published.owner.userId,
        published.profileId,
        2,
        published.assetId,
      );
      expect(
        await publicDb
          .prepare("SELECT writer_state FROM v2_physical_blob_bindings WHERE blob_id=?")
          .bind(copied.blobId)
          .first<string>("writer_state"),
      ).toBe("stopped");
      for (const value of [originalWork, publicWork.work]) {
        expect(value.statements).toBeLessThan(900);
        expect(value.rowsRead).toBeLessThan(1000000);
        expect(value.rowsWritten).toBeLessThan(5000);
      }
      expect(failures).toEqual([]);
      copies.push({ ...publicWork.work, history: count });
    }
    expect(copies[1]?.rowsRead).toBeLessThanOrEqual((copies[0]?.rowsRead ?? 0) + 50);
    console.info(
      "Synthetic native lawyer storage D1 measurements",
      JSON.stringify({ original: originalWork, publicCopies: copies }),
    );
  } finally {
    await mf.dispose();
  }
}, 120000);
