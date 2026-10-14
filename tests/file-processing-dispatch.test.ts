import { expect, test } from "bun:test";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import {
  createFileProcessingDispatcher,
  type FileProcessingBinding,
} from "../src/server/modules/file-processing/dispatch";
import type { FileProcessingParams } from "../src/server/modules/file-processing/execution";
import { nativeJobId } from "../src/server/modules/file-processing/native-identity";
import { digest } from "../src/server/modules/files/binary";
import { fixture, uploaded } from "./helpers/file-processing-fixture";

async function setup(environment?: "preview" | "production") {
  const f = await fixture(),
    bytes = new TextEncoder().encode("Synthetic dispatched file");
  const u = await uploaded(f, bytes),
    jobs = createV2JobsRepository(f.core),
    jobId = nativeJobId("file"),
    operationId = crypto.randomUUID();
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: { operationId, key: crypto.randomUUID(), requestHash: await digest(bytes) },
        quotas: [],
      },
    ),
  ).toBe(true);
  const outbox = f.db.sqlite
    .query("SELECT id,target_id FROM v2_outbox WHERE job_id=?")
    .get(jobId) as { id: string; target_id: string };
  const instances = new Map<string, FileProcessingParams>();
  const inputs: Parameters<FileProcessingBinding["create"]>[0][] = [];
  let calls = 0,
    ambiguous = false;
  let beforeGet: (() => void) | undefined, duringCreate: (() => void) | undefined;
  const binding: FileProcessingBinding = {
    async get(id) {
      beforeGet?.();
      if (!instances.has(id)) throw new Error("Synthetic absent instance");
      return {
        id,
        async status() {
          if (ambiguous) throw new Error("Synthetic unavailable metadata");
          return { status: "queued" };
        },
      };
    },
    async create(input) {
      const { id, params } = input;
      inputs.push(structuredClone(input));
      calls++;
      if (instances.has(id)) throw new Error("Synthetic duplicate ID");
      instances.set(id, structuredClone(params));
      duringCreate?.();
      return binding.get(id);
    },
  };
  let time = Date.parse(f.actor.now);
  const clock = () => new Date(time).toISOString();
  const dispatcher = createFileProcessingDispatcher(f.core, {
    binding,
    clock,
    ...(environment === undefined ? {} : { environment }),
  });
  const params = {
    ownerId: f.actor.ownerId,
    workspaceId: f.workspaceId,
    fileId: u.session.fileId,
    fileRevision: 2,
    jobId,
  };
  return {
    ...f,
    jobs,
    jobId,
    operationId,
    outbox,
    params,
    instances,
    inputs,
    binding,
    clock,
    dispatcher,
    calls: () => calls,
    advance: (ms = 61000) => {
      time += ms;
    },
    failMetadata: () => {
      ambiguous = true;
    },
    recoverMetadata: () => {
      ambiguous = false;
    },
    beforeGet: (fn: () => void) => {
      beforeGet = fn;
    },
    duringCreate: (fn: () => void) => {
      duringCreate = fn;
    },
  };
}
test("real admitted file job concurrent CAS dispatches once using its exact durable runtime ID", async () => {
  const f = await setup("preview");
  const results = await Promise.all([f.dispatcher.dispatch(), f.dispatcher.dispatch()]);
  expect(results.reduce((n, r) => n + r.dispatched, 0)).toBe(1);
  expect(f.calls()).toBe(1);
  expect(f.inputs).toEqual([{ id: f.outbox.target_id, params: f.params, locationHint: "apac" }]);
  expect(f.instances.get(`${f.jobId}-1`)).toEqual(f.params);
  expect(
    f.db.sqlite.query("SELECT state,attempts FROM v2_outbox WHERE id=?").get(f.outbox.id),
  ).toEqual({ state: "dispatched", attempts: 1 });
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
});
test("accepted creation with unknown response reconciles the same instance without duplicate processing", async () => {
  const f = await setup("preview");
  f.duringCreate(() => f.failMetadata());
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  f.advance();
  f.recoverMetadata();
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 1, pending: 0, available: true });
  expect(f.calls()).toBe(1);
  expect(f.instances.size).toBe(1);
  expect(f.inputs).toEqual([{ id: f.outbox.target_id, params: f.params, locationHint: "apac" }]);
});
test("missing binding, revoked policy/file consent and wrong current revision never create", async () => {
  for (const change of [
    "policy",
    "fileConsent",
    "fileRevision",
    "pointer",
    "instance",
    "tombstone",
  ] as const) {
    const f = await setup();
    expect(await createFileProcessingDispatcher(f.core).dispatch()).toEqual({
      dispatched: 0,
      pending: 0,
      available: false,
    });
    if (change === "policy")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    else if (change === "fileConsent")
      f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.params.fileId);
    else if (change === "fileRevision")
      f.db.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(f.params.fileId);
    else if (change === "pointer")
      f.db.sqlite.query("UPDATE v2_files SET current_job_id=NULL WHERE id=?").run(f.params.fileId);
    else if (change === "instance")
      f.db.sqlite
        .query("UPDATE v2_jobs SET runtime_instance_id=? WHERE id=?")
        .run(crypto.randomUUID(), f.jobId);
    else
      f.db.sqlite
        .query("INSERT INTO v2_tombstones VALUES('file',?,?)")
        .run(f.params.fileId, f.clock());
    expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
    expect(f.calls()).toBe(0);
    expect(f.db.sqlite.query("SELECT attempts FROM v2_outbox WHERE id=?").get(f.outbox.id)).toEqual(
      { attempts: 0 },
    );
  }
});
test("deletion during platform lookup denies create, and deletion after create denies acknowledgement", async () => {
  for (const afterCreate of [false, true]) {
    const f = await setup("preview");
    const remove = () =>
      f.db.sqlite
        .query("INSERT OR IGNORE INTO v2_tombstones VALUES('workspace',?,?)")
        .run(f.workspaceId, f.clock());
    if (afterCreate) f.duringCreate(remove);
    else f.beforeGet(remove);
    expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
    expect(f.calls()).toBe(afterCreate ? 1 : 0);
    expect(f.db.sqlite.query("SELECT state FROM v2_outbox WHERE id=?").get(f.outbox.id)).toEqual({
      state: "pending",
    });
  }
});

test("a preview platform rejection remains pending and recovers only the same hinted instance", async () => {
  const f = await setup("preview"),
    originalCreate = f.binding.create,
    rejected: Parameters<FileProcessingBinding["create"]>[0][] = [];
  f.binding.create = async (input) => {
    rejected.push(structuredClone(input));
    throw new Error("Synthetic unsupported platform preference");
  };
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(f.instances.size).toBe(0);
  expect(f.inputs).toEqual([]);
  expect(rejected).toEqual([{ id: f.outbox.target_id, params: f.params, locationHint: "apac" }]);
  expect(f.db.sqlite.query("SELECT state FROM v2_outbox WHERE id=?").get(f.outbox.id)).toEqual({
    state: "pending",
  });
  f.binding.create = originalCreate;
  f.advance();
  expect((await f.dispatcher.dispatch()).dispatched).toBe(1);
  expect(f.inputs).toEqual(rejected);
  expect(f.instances.size).toBe(1);
});
test("running current job can reconcile an existing instance but never creates a second one", async () => {
  const f = await setup("preview");
  f.instances.set(f.outbox.target_id, f.params);
  const acquired = await f.jobs.acquire(
    { ...f.actor, now: f.clock() },
    f.jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.clock()) + 60000).toISOString(),
  );
  if (!acquired) throw new Error("Actual file lease required");
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 1, pending: 0, available: true });
  expect(f.calls()).toBe(0);
});
test("expired creation window and invalid platform ID remain pending without a new workflow", async () => {
  const f = await setup();
  f.duringCreate(() => f.failMetadata());
  expect((await f.dispatcher.dispatch()).pending).toBe(1);
  f.advance(25 * 60 * 60 * 1000);
  f.recoverMetadata();
  f.instances.clear();
  expect((await f.dispatcher.dispatch()).pending).toBe(1);
  expect(f.calls()).toBe(1);
  const g = await setup(),
    invalid = "a".repeat(101);
  g.db.sqlite.query("UPDATE v2_jobs SET runtime_instance_id=? WHERE id=?").run(invalid, g.jobId);
  g.db.sqlite.query("UPDATE v2_outbox SET target_id=? WHERE id=?").run(invalid, g.outbox.id);
  expect((await g.dispatcher.dispatch()).pending).toBe(1);
  expect(g.calls()).toBe(0);
});

for (const environment of ["preview", "production", undefined, false] as const)
  test(`file Workflow placement is opt-in only for exact preview: ${environment}`, async () => {
    // false exercises a malformed JavaScript caller; it is not a supported Env value.
    const f = await setup(environment as "preview" | "production" | undefined);
    const identity = () =>
      f.db.sqlite
        .query(
          "SELECT id,operation_id,runtime_instance_id,target_id,target_revision FROM v2_jobs WHERE id=?",
        )
        .get(f.jobId);
    const before = identity();
    expect((await f.dispatcher.dispatch()).dispatched).toBe(1);
    expect(f.inputs).toEqual([
      {
        id: f.outbox.target_id,
        params: f.params,
        ...(environment === "preview" ? { locationHint: "apac" } : {}),
      },
    ]);
    if (environment === "preview") expect(f.inputs[0]).toHaveProperty("locationHint", "apac");
    else expect(f.inputs[0]).not.toHaveProperty("locationHint");
    expect(identity()).toEqual(before);
  });

for (const change of ["policy", "file_consent", "revision", "tombstone", "lease", "claim"] as const)
  test(`preview placement cannot bypass ${change} changing after lookup`, async () => {
    const f = await setup("preview");
    f.beforeGet(() => {
      if (change === "policy")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      else if (change === "file_consent")
        f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.params.fileId);
      else if (change === "revision")
        f.db.sqlite
          .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
          .run(f.params.fileId);
      else if (change === "tombstone")
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('file',?,?)")
          .run(f.params.fileId, f.clock());
      else if (change === "lease") f.advance();
      else
        f.db.sqlite.query("UPDATE v2_outbox SET attempts=attempts+1 WHERE id=?").run(f.outbox.id);
    });
    expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
    expect(f.inputs).toEqual([]);
    expect(f.db.sqlite.query("SELECT state FROM v2_outbox WHERE id=?").get(f.outbox.id)).toEqual({
      state: "pending",
    });
  });
