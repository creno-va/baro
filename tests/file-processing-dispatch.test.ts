import { expect, test } from "bun:test";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import {
  createFileProcessingDispatcher,
  type FileProcessingBinding,
} from "../src/server/modules/file-processing/dispatch";
import type { FileProcessingParams } from "../src/server/modules/file-processing/execution";
import { digest } from "../src/server/modules/files/binary";
import { fixture, uploaded } from "./helpers/file-processing-fixture";

async function setup() {
  const f = await fixture(),
    bytes = new TextEncoder().encode("Synthetic dispatched file");
  const u = await uploaded(f, bytes),
    jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
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
    async create({ id, params }) {
      calls++;
      if (instances.has(id)) throw new Error("Synthetic duplicate ID");
      instances.set(id, structuredClone(params));
      duringCreate?.();
      return binding.get(id);
    },
  };
  let time = Date.parse(f.actor.now);
  const clock = () => new Date(time).toISOString();
  const dispatcher = createFileProcessingDispatcher(f.core, { binding, clock });
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
  const f = await setup();
  const results = await Promise.all([f.dispatcher.dispatch(), f.dispatcher.dispatch()]);
  expect(results.reduce((n, r) => n + r.dispatched, 0)).toBe(1);
  expect(f.calls()).toBe(1);
  expect(f.instances.get(`${f.jobId}-1`)).toEqual(f.params);
  expect(
    f.db.sqlite.query("SELECT state,attempts FROM v2_outbox WHERE id=?").get(f.outbox.id),
  ).toEqual({ state: "dispatched", attempts: 1 });
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
});
test("accepted creation with unknown response reconciles the same instance without duplicate processing", async () => {
  const f = await setup();
  f.duringCreate(() => f.failMetadata());
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  f.advance();
  f.recoverMetadata();
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 1, pending: 0, available: true });
  expect(f.calls()).toBe(1);
  expect(f.instances.size).toBe(1);
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
    const f = await setup();
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
test("running current job can reconcile an existing instance but never creates a second one", async () => {
  const f = await setup();
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
