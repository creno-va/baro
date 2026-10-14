import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createFilesApi } from "../src/server/api/v2/files";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import {
  createFileProcessingDispatcher,
  type FileProcessingBinding,
} from "../src/server/modules/file-processing/dispatch";
import { digest } from "../src/server/modules/files/binary";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import type { PrivateBucket } from "../src/server/modules/files/service";
import { createFileProcessingAdmission } from "../src/server/runtime/file-admission";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Actual signed API access, migrations, AES, storage and processing admission.
// Only external R2/probe/Workflow transports use synthetic local adapters.
async function fixture(
  options: { failAck?: boolean; taskThrows?: boolean; concurrentCron?: boolean } = {},
) {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const actor = { ownerId: owner.userId, now: new Date().toISOString() };
  let time = Date.parse(actor.now);
  const clock = () => new Date(time).toISOString();
  const events: string[] = [];
  const ackEntered = deferred(),
    releaseAck = deferred();
  let intercepted = false,
    ackCompleted = false;
  const batch = db.binding.batch.bind(db.binding);
  db.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    const result = await batch<T>(statements);
    const job = db.sqlite.query("SELECT id FROM v2_jobs WHERE kind='file_processing'").get();
    if (job && !intercepted) {
      intercepted = true;
      events.push("admission_committed");
      ackEntered.resolve();
      await releaseAck.promise;
      if (options.failAck) throw new Error("SYNTHETIC_COMMITTED_ACK_LOST");
      ackCompleted = true;
      events.push("admission_acknowledged");
    }
    return result;
  };
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const bucket = {
    async put(key: string, body: Uint8Array<ArrayBuffer>) {
      objects.set(key, body.slice());
      return { key, size: body.byteLength };
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as PrivateBucket;
  let created = 0,
    ambiguous = false;
  let beforeGet: (() => void) | undefined;
  const instances = new Set<string>();
  const workflow: FileProcessingBinding = {
    async get(id) {
      beforeGet?.();
      if (!instances.has(id)) throw new Error("SYNTHETIC_INSTANCE_ABSENT");
      return {
        id,
        status: async () => {
          if (ambiguous) throw new Error("SYNTHETIC_RESPONSE_UNKNOWN");
          return { status: "queued" };
        },
      };
    },
    async create({ id }) {
      events.push("workflow_create");
      instances.add(id);
      created++;
      return workflow.get(id);
    },
  };
  const env = {
    ...owner.env,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: bucket,
    FILE_PROCESSING: workflow,
  } as unknown as Env;
  const core = createV2Core(db.binding, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const payload = await core.encrypt("v2_workspaces", workspaceId, owner.userId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, owner.userId, payload, actor.now, actor.now);
  db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
  db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const app = new Hono<ApiEnvironment>().route(
    "/v2/cases",
    createFilesApi({
      testOnlyMissingD1Meta: true,
      dependencies: async (environment, requestCore, ownerId, afterComplete) => {
        expect(requestCore.applicationCostLimitsEnabled).toBe(false);
        return {
          bucket,
          clock,
          paidStorage: createFileStorageBudget(requestCore, "preview", ownerId, clock),
          ...createFileProcessingAdmission(
            requestCore,
            environment,
            {},
            clock,
            afterComplete
              ? (task) =>
                  afterComplete(() => {
                    events.push("background_started");
                    expect(ackCompleted).toBe(true);
                    if (options.taskThrows) throw new Error("SYNTHETIC_COLD_TASK_FAILURE");
                    if (options.concurrentCron)
                      return Promise.all([task(), dispatcher.dispatch()]).then(() => {});
                    return task();
                  })
              : undefined,
          ),
          probe: async (input) => {
            const bytes = await new Response(input.open()).arrayBuffer();
            expect(bytes.byteLength).toBe(input.byteLength);
            return {
              category: "document",
              format: "txt",
              pageCount: 1,
              byteLength: bytes.byteLength,
            };
          },
        };
      },
    }),
  );
  const headers = { cookie: owner.cookie, origin: env.BETTER_AUTH_URL };
  const bytes = new TextEncoder().encode("Synthetic customer file for immediate dispatch.");
  const reservation = await app.request(
    `/v2/cases/${workspaceId}/files`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "if-match": "1",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        name: "synthetic-wake.txt",
        byteLength: bytes.byteLength,
        mediaType: "text/plain",
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      }),
    },
    env,
  );
  expect(reservation.status).toBe(201);
  const reserved = (await reservation.json()) as { fileId: string; uploadSession: string };
  const part = await app.request(
    `/v2/cases/${workspaceId}/files/${reserved.fileId}/parts/0`,
    {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "x-upload-session": reserved.uploadSession,
      },
      body: bytes,
    },
    env,
  );
  expect(part.status).toBe(200);
  const partValue = await part.json();
  const revision = (
    db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
      revision: number;
    }
  ).revision;
  const body = JSON.stringify({
    expectedRevision: revision,
    uploadSession: reserved.uploadSession,
    manifest: {
      byteLength: bytes.byteLength,
      contentHash: await digest(bytes),
      parts: [partValue],
    },
  });
  const pending: Promise<unknown>[] = [];
  const execution = {
    waitUntil(task: Promise<unknown>) {
      pending.push(task);
    },
    passThroughOnException() {},
    props: {},
  };
  const complete = (withContext = true, authenticated = true) =>
    app.request(
      `/v2/cases/${workspaceId}/files/${reserved.fileId}/complete`,
      {
        method: "POST",
        headers: {
          ...(authenticated ? headers : { origin: env.BETTER_AUTH_URL }),
          "content-type": "application/json",
        },
        body,
      },
      env,
      withContext ? execution : undefined,
    );
  const outbox = () =>
    db.sqlite
      .query(
        "SELECT state,attempts,target_id,job_id,next_attempt_at FROM v2_outbox WHERE kind='job_dispatch'",
      )
      .get() as {
      state: string;
      attempts: number;
      target_id: string;
      job_id: string;
      next_attempt_at: string;
    };
  const dispatcher = createFileProcessingDispatcher(core, {
    environment: "preview",
    binding: workflow,
    clock,
  });
  return {
    db,
    actor,
    workspaceId,
    fileId: reserved.fileId,
    events,
    objects,
    complete,
    pending,
    ackEntered,
    releaseAck,
    outbox,
    dispatcher,
    created: () => created,
    beforeGet: (hook: () => void) => {
      beforeGet = hook;
    },
    ambiguous: (value: boolean) => {
      ambiguous = value;
    },
    advance: () => {
      time += 61000;
    },
  };
}

test("signed file complete wakes its committed exact job only after the admission ACK", async () => {
  const f = await fixture();
  const request = f.complete();
  await f.ackEntered.promise;
  expect(f.outbox()).toMatchObject({ state: "pending", attempts: 0 });
  expect(f.created()).toBe(0);
  expect(f.pending).toHaveLength(0);
  f.releaseAck.resolve();
  const response = await request;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ processingQueued: true });
  await Promise.all(f.pending);
  expect(f.pending).toHaveLength(1);
  expect(f.created()).toBe(1);
  expect(f.events).toEqual([
    "admission_committed",
    "admission_acknowledged",
    "background_started",
    "workflow_create",
  ]);
  expect(f.outbox()).toMatchObject({ state: "dispatched", attempts: 1 });
  expect(f.objects.size).toBe(1);
  expect((await f.dispatcher.dispatch()).dispatched).toBe(0);
});

test("lost committed admission ACK never starts wake and leaves scheduled recovery intact", async () => {
  const f = await fixture({ failAck: true });
  const request = f.complete();
  await f.ackEntered.promise;
  const before = f.outbox();
  f.releaseAck.resolve();
  expect((await request).status).toBe(500);
  expect(f.created()).toBe(0);
  expect(f.pending).toHaveLength(0);
  expect(f.outbox()).toEqual(before);
  expect((await f.dispatcher.dispatch()).dispatched).toBe(1);
  expect(f.outbox()).toMatchObject({
    state: "dispatched",
    target_id: before.target_id,
    job_id: before.job_id,
  });
});

for (const mode of ["missing_context", "task_throw"] as const) {
  test(`${mode} preserves successful complete and scheduled recovery`, async () => {
    const f = await fixture({ taskThrows: mode === "task_throw" });
    const request = f.complete(mode !== "missing_context");
    await f.ackEntered.promise;
    f.releaseAck.resolve();
    expect((await request).status).toBe(200);
    await Promise.all(f.pending);
    expect(f.created()).toBe(0);
    expect(f.outbox()).toMatchObject({ state: "pending", attempts: 0 });
    expect((await f.dispatcher.dispatch()).dispatched).toBe(1);
  });
}

test("unsigned complete cannot reach probe, processing admission or wake", async () => {
  const f = await fixture();
  expect((await f.complete(true, false)).status).toBe(401);
  expect(f.events).toEqual([]);
  expect(f.pending).toHaveLength(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});

test("concurrent scheduled dispatch and complete replay keep one durable runtime", async () => {
  const f = await fixture({ concurrentCron: true });
  const request = f.complete();
  await f.ackEntered.promise;
  const target = f.outbox();
  for (const mismatch of [
    { ownerId: crypto.randomUUID() },
    { jobId: crypto.randomUUID() },
    { instanceId: `${target.job_id}-2` },
  ])
    expect(
      (
        await f.dispatcher.dispatchOne({
          ownerId: f.actor.ownerId,
          jobId: target.job_id,
          instanceId: target.target_id,
          ...mismatch,
        })
      ).dispatched,
    ).toBe(0);
  f.releaseAck.resolve();
  expect((await request).status).toBe(200);
  await Promise.all(f.pending);
  expect(f.created()).toBe(1);
  expect(f.outbox()).toMatchObject({ state: "dispatched", attempts: 1 });
  expect((await f.complete()).status).toBe(200);
  expect(f.pending).toHaveLength(1);
  expect(f.created()).toBe(1);
});

for (const revoked of ["policy", "file_consent", "workspace", "file", "pointer"] as const)
  test(`current ${revoked} revocation after admission prevents immediate creation`, async () => {
    const f = await fixture();
    const request = f.complete();
    await f.ackEntered.promise;
    if (revoked === "policy")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    else if (revoked === "file_consent")
      f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.fileId);
    else if (revoked === "pointer")
      f.db.sqlite.query("UPDATE v2_files SET current_job_id=NULL WHERE id=?").run(f.fileId);
    else
      f.db.sqlite
        .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
        .run(revoked, revoked === "file" ? f.fileId : f.workspaceId, f.actor.now);
    const before = f.outbox();
    f.releaseAck.resolve();
    expect((await request).status).toBe(200);
    await Promise.all(f.pending);
    expect(f.created()).toBe(0);
    expect(f.outbox()).toEqual(before);
  });

test("ambiguous wake preserves the lease and recovers the same instance without another create", async () => {
  const f = await fixture();
  f.ambiguous(true);
  const request = f.complete();
  await f.ackEntered.promise;
  const before = f.outbox();
  const journal = f.db.sqlite
    .query("SELECT attempt_id,state FROM v2_execution_admissions WHERE kind='job'")
    .all();
  f.releaseAck.resolve();
  expect((await request).status).toBe(200);
  await Promise.all(f.pending);
  expect(f.created()).toBe(1);
  expect(f.outbox()).toMatchObject({
    state: "pending",
    attempts: 1,
    job_id: before.job_id,
    target_id: before.target_id,
  });
  expect((await f.dispatcher.dispatch()).dispatched).toBe(0);
  f.advance();
  f.ambiguous(false);
  expect((await f.dispatcher.dispatch()).dispatched).toBe(1);
  expect(f.created()).toBe(1);
  expect(
    f.db.sqlite
      .query("SELECT attempt_id,state FROM v2_execution_admissions WHERE kind='job'")
      .all(),
  ).toEqual(journal);
});
