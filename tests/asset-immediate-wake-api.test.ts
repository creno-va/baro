import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createLawyersApi } from "../src/server/api/v2/lawyers";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  type AssetProcessingBinding,
  createAssetProcessingDispatcher,
} from "../src/server/modules/file-processing/dispatch";
import type { PrivateBucket } from "../src/server/modules/files/service";
import {
  createLawyerStorageBudget,
  hasLawyerStorageMeter,
} from "../src/server/modules/lawyers/storage-runtime";
import { createAssetProcessingAdmission } from "../src/server/runtime/asset-admission";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixedLength(length: number) {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      size += bytes.length;
      if (size > length) throw new Error("SYNTHETIC_STREAM_OVERFLOW");
      controller.enqueue(bytes);
    },
    flush() {
      if (size !== length) throw new Error("SYNTHETIC_STREAM_TRUNCATED");
    },
  });
}

// Real migrations, signed Better Auth session, crypto, storage/admission and Hono.
// Only local SQLite/R2/Workflow IO is adapted. SQLite has no native row metadata;
// APP_ENV=local selects the existing local meter behavior, never an auth bypass.
async function fixture(
  options: { failReadback?: boolean; taskThrows?: boolean; exhaust?: boolean } = {},
) {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const events: string[] = [];
  const readbackEntered = deferred(),
    releaseReadback = deferred();
  let registered = false,
    intercepted = false,
    readbackFinished = false;
  let backgroundReads = 0;
  const prepare = db.binding.prepare.bind(db.binding),
    batch = db.binding.batch.bind(db.binding);
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (base: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const statement = {
      bind: (...values: unknown[]) => wrap(base.bind(...values), sql),
      async all<T>() {
        if (
          registered &&
          !intercepted &&
          sql.startsWith("SELECT a.id FROM v2_assets a JOIN v2_profiles p")
        ) {
          intercepted = true;
          events.push("readback_entered");
          readbackEntered.resolve();
          await releaseReadback.promise;
          if (options.failReadback) throw new Error("SYNTHETIC_READBACK_FAILURE");
          const result = await base.all<T>();
          readbackFinished = true;
          events.push("readback_completed");
          return result;
        }
        return base.all<T>();
      },
      run: <T>() => base.run<T>(),
      first: <T>(column?: string) =>
        column === undefined ? base.first<T>() : base.first<T>(column),
      raw: <T>() => base.raw<T>(),
    } as D1PreparedStatement;
    originals.set(statement, base);
    return statement;
  };
  db.binding.prepare = (sql) => wrap(prepare(sql), sql);
  db.binding.batch = <T>(statements: D1PreparedStatement[]) =>
    batch<T>(statements.map((statement) => originals.get(statement) ?? statement));

  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, bytes);
      return { key, size: bytes.length };
    },
  } as unknown as PrivateBucket;
  let created = 0;
  const instances = new Set<string>();
  const workflow: AssetProcessingBinding = {
    async get(id) {
      events.push("workflow_get");
      if (!instances.has(id)) throw new Error("SYNTHETIC_INSTANCE_ABSENT");
      return { id, status: async () => ({ status: "running" }) };
    },
    async create({ id }) {
      events.push("workflow_create");
      instances.add(id);
      created++;
      return { id, status: async () => ({ status: "running" }) };
    },
  };
  const env = {
    ...owner.env,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: bucket,
    ASSET_PROCESSING: workflow,
    FILE_PROCESSOR: {},
  } as unknown as Env;
  const core = createV2Core(db.binding, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: false,
  });
  const profileId = crypto.randomUUID();
  expect(
    await createV2LawyersRepository(core).createProfile(
      { ownerId: owner.userId, now: new Date().toISOString() },
      profileId,
    ),
  ).toBe(true);
  db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,'lawyer')")
    .run(`account-type:${owner.userId}`);
  db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const app = new Hono<ApiEnvironment>().route(
    "/v2/me",
    createLawyersApi({
      dependencies: async (environment, bounded, ownerId, afterUpload) => {
        expect(hasLawyerStorageMeter(bounded)).toBe(true);
        return {
          bucket,
          fixedLengthStream: fixedLength,
          paidStorage: () => createLawyerStorageBudget(bounded, "preview", ownerId),
          ...createAssetProcessingAdmission(
            bounded,
            environment,
            {},
            undefined,
            afterUpload
              ? (task) => {
                  registered = true;
                  events.push("admission_committed");
                  afterUpload(() => {
                    events.push("background_started");
                    expect(readbackFinished).toBe(true);
                    if (options.taskThrows) throw new Error("SYNTHETIC_COLD_TASK_FAILURE");
                    return (async () => {
                      if (options.exhaust) {
                        for (let i = 0; i < 900; i++) {
                          try {
                            await bounded.statement("SELECT 1").first();
                            backgroundReads++;
                          } catch {
                            break;
                          }
                        }
                      }
                      await task();
                    })();
                  });
                }
              : undefined,
          ),
        };
      },
    }),
  );
  const headers = { cookie: owner.cookie, origin: env.BETTER_AUTH_URL };
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const reservation = await app.request(
    "/v2/me/lawyer/portfolio-assets",
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "if-match": "1",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        purpose: "profile_photo",
        name: "synthetic-wake.jpg",
        byteLength: bytes.length,
        mediaType: "image/jpeg",
      }),
    },
    env,
  );
  expect(reservation.status).toBe(201);
  const reserved = (await reservation.json()) as { assetId: string };
  const pending: Promise<unknown>[] = [];
  const execution = {
    waitUntil(task: Promise<unknown>) {
      events.push("wait_until");
      pending.push(task);
    },
    passThroughOnException() {},
    props: {},
  };
  const upload = (withContext = true, authenticated = true) =>
    app.request(
      `/v2/me/lawyer/assets/${reserved.assetId}/content`,
      {
        method: "PUT",
        headers: {
          ...(authenticated ? headers : { origin: env.BETTER_AUTH_URL }),
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          "if-match": "1",
        },
        body: bytes,
      },
      env,
      withContext ? execution : undefined,
    );
  const outbox = () =>
    db.sqlite
      .query("SELECT state,attempts,target_id,job_id FROM v2_outbox WHERE kind='job_dispatch'")
      .get() as { state: string; attempts: number; target_id: string; job_id: string };
  const recover = () =>
    createAssetProcessingDispatcher(core, { environment: "preview", binding: workflow }).dispatch(
      1,
    );
  return {
    db,
    events,
    objects,
    upload,
    pending,
    readbackEntered,
    releaseReadback,
    outbox,
    recover,
    created: () => created,
    backgroundReads: () => backgroundReads,
  };
}

test("signed API PUT starts exact wake only after committed admission and final readback", async () => {
  const f = await fixture();
  const request = f.upload();
  await f.readbackEntered.promise;
  expect(f.outbox()).toMatchObject({ state: "pending", attempts: 0 });
  expect(f.created()).toBe(0);
  expect(f.pending).toHaveLength(0);
  expect(f.events).toEqual(["admission_committed", "readback_entered"]);
  f.releaseReadback.resolve();
  const response = await request;
  expect(response.status).toBe(200);
  // The encrypted upload DTO remains revision 2; admission records the live
  // sanitizer state in the asset row without rewriting that stored DTO.
  const result = (await response.json()) as {
    processingQueued: boolean;
    value: { status: string };
  };
  expect(result.processingQueued).toBe(true);
  expect(result.value.status).toBe("uploaded");
  expect(f.db.sqlite.query("SELECT state FROM v2_assets").get()).toEqual({ state: "sanitizing" });
  await Promise.all(f.pending);
  expect(f.events.indexOf("background_started")).toBeGreaterThan(
    f.events.indexOf("readback_completed"),
  );
  expect(f.created()).toBe(1);
  expect(f.pending).toHaveLength(1);
  expect(f.outbox()).toMatchObject({ state: "dispatched", attempts: 1 });
  expect(f.objects.size).toBe(1);
  expect((await f.recover()).dispatched).toBe(0);
});

test("failed foreground readback does not launch wake and preserves the exact outbox for recovery", async () => {
  const f = await fixture({ failReadback: true });
  const request = f.upload();
  await f.readbackEntered.promise;
  const before = f.outbox();
  f.releaseReadback.resolve();
  expect((await request).status).toBe(500);
  expect(f.pending).toHaveLength(0);
  expect(f.created()).toBe(0);
  expect(f.outbox()).toEqual(before);
  expect((await f.recover()).dispatched).toBe(1);
  expect(f.outbox()).toMatchObject({
    state: "dispatched",
    target_id: before.target_id,
    job_id: before.job_id,
  });
});

for (const mode of ["missing_context", "synchronous_task_failure"] as const) {
  test(`${mode} leaves a successful upload and durable scheduled recovery`, async () => {
    const f = await fixture({ taskThrows: mode === "synchronous_task_failure" });
    const request = f.upload(mode !== "missing_context");
    await f.readbackEntered.promise;
    f.releaseReadback.resolve();
    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processingQueued: true });
    await Promise.all(f.pending);
    expect(f.created()).toBe(0);
    expect(f.outbox()).toMatchObject({ state: "pending", attempts: 0 });
    if (mode === "missing_context") expect(f.events).not.toContain("background_started");
    expect((await f.recover()).dispatched).toBe(1);
  });
}

test("background dispatch retains the original request meter instead of resetting its allowance", async () => {
  const f = await fixture({ exhaust: true });
  const request = f.upload();
  await f.readbackEntered.promise;
  f.releaseReadback.resolve();
  expect((await request).status).toBe(200);
  await Promise.all(f.pending);
  expect(f.backgroundReads()).toBeGreaterThan(0);
  expect(f.backgroundReads()).toBeLessThan(866);
  expect(f.created()).toBe(0);
  expect(f.outbox()).toMatchObject({ state: "pending", attempts: 0 });
  expect((await f.recover()).dispatched).toBe(1);
});

test("unsigned API upload cannot reach storage, admission or background scheduling", async () => {
  const f = await fixture();
  expect((await f.upload(true, false)).status).toBe(401);
  expect(f.objects.size).toBe(0);
  expect(f.events).toEqual([]);
  expect(f.pending).toHaveLength(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});
