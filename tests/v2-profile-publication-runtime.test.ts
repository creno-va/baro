import { expect, test } from "bun:test";
import type { WorkflowStep } from "cloudflare:workers";
import {
  createProfilePublicationDispatcher,
  type ProfilePublicationBinding,
} from "../src/server/modules/lawyers/publication-dispatch";
import {
  createProfilePublicationExecution,
  type ProfilePublicationParams,
  profilePublicationInstanceId,
  runProfilePublicationSteps,
} from "../src/server/modules/lawyers/publication-execution";
import { publicationFixture } from "./helpers/lawyer-publication";

async function fixture() {
  const f = await publicationFixture();
  const row = f.db.sqlite
    .query("SELECT id,operation_id,target_id,revision FROM v2_outbox WHERE kind='profile_publish'")
    .get() as { id: string; operation_id: string; target_id: string; revision: number };
  const params = {
    outboxId: row.id,
    operationId: row.operation_id,
    profileId: row.target_id,
    approvedRevision: row.revision,
  };
  const instances = new Map<string, { id: string; params: ProfilePublicationParams }>();
  let calls = 0,
    unavailable = false,
    duringCreate: (() => void) | undefined;
  const binding: ProfilePublicationBinding = {
    async get(id) {
      const value = instances.get(id);
      if (!value) throw new Error("Synthetic instance absent");
      return {
        id: value.id,
        async status() {
          if (unavailable) throw new Error("Synthetic metadata unavailable");
          return { status: "queued" };
        },
      };
    },
    async create(input) {
      calls++;
      if (instances.has(input.id)) throw new Error("Synthetic duplicate ID");
      instances.set(input.id, { id: input.id, params: structuredClone(input.params) });
      duringCreate?.();
      return binding.get(input.id);
    },
  };
  let time = Date.now();
  const clock = () => new Date(time).toISOString();
  const dispatcher = createProfilePublicationDispatcher(f.core, { binding, clock });
  const execution = () =>
    createProfilePublicationExecution(
      f.core,
      { ...f.deps, clock },
      params,
      profilePublicationInstanceId(params),
    );
  return {
    ...f,
    params,
    instances,
    binding,
    clock,
    dispatcher,
    execution,
    calls: () => calls,
    advance: (milliseconds = 61000) => {
      time += milliseconds;
    },
    failMetadata: () => {
      unavailable = true;
    },
    recoverMetadata: () => {
      unavailable = false;
    },
    duringCreate: (fn: () => void) => {
      duringCreate = fn;
    },
  };
}
test("concurrent actual SQL claims create one stable platform instance and acknowledge once", async () => {
  const f = await fixture();
  const results = await Promise.all([f.dispatcher.dispatch(), f.dispatcher.dispatch()]);
  expect(results.reduce((n, v) => n + v.dispatched, 0)).toBe(1);
  expect(f.calls()).toBe(1);
  expect(f.instances.size).toBe(1);
  expect(f.instances.get(profilePublicationInstanceId(f.params))?.params).toEqual(f.params);
  expect(
    f.db.sqlite.query("SELECT state,attempts FROM v2_outbox WHERE id=?").get(f.params.outboxId),
  ).toEqual({ state: "dispatched", attempts: 1 });
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  expect(f.calls()).toBe(1);
});
test("creation ambiguity preserves lease and recovery gets the same existing instance", async () => {
  const f = await fixture();
  f.duringCreate(() => f.failMetadata());
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(f.calls()).toBe(1);
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  f.advance();
  f.recoverMetadata();
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 1, pending: 0, available: true });
  expect(f.calls()).toBe(1);
  expect(f.instances.size).toBe(1);
  expect(
    f.db.sqlite.query("SELECT state,attempts FROM v2_outbox WHERE id=?").get(f.params.outboxId),
  ).toEqual({ state: "dispatched", attempts: 2 });
});
test("missing binding and revoked approval deny before platform creation", async () => {
  const f = await fixture();
  expect(await createProfilePublicationDispatcher(f.core).dispatch()).toEqual({
    dispatched: 0,
    pending: 0,
    available: false,
  });
  f.db.sqlite
    .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
    .run(f.revisionId);
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  expect(f.calls()).toBe(0);
  expect(
    f.db.sqlite.query("SELECT attempts FROM v2_outbox WHERE id=?").get(f.params.outboxId),
  ).toEqual({ attempts: 0 });
});
test("expired creation window never recreates an absent platform instance after ambiguity", async () => {
  const f = await fixture();
  f.duringCreate(() => f.failMetadata());
  expect((await f.dispatcher.dispatch()).pending).toBe(1);
  f.advance(25 * 60 * 60 * 1000);
  f.recoverMetadata();
  f.instances.clear();
  expect(await f.dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(f.calls()).toBe(1);
  expect(f.instances.size).toBe(0);
});
test("approval revoked during awaited platform lookup denies subsequent creation", async () => {
  const f = await fixture();
  const dispatcher = createProfilePublicationDispatcher(f.core, {
    clock: f.clock,
    binding: {
      create: (input) => f.binding.create(input),
      async get() {
        f.db.sqlite
          .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
          .run(f.revisionId);
        throw new Error("Synthetic instance absent");
      },
    },
  });
  expect(await dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 1, available: true });
  expect(f.calls()).toBe(0);
});
test("stable Workflow ID respects platform length for maximum opaque IDs", () => {
  const p = {
    outboxId: "a".repeat(128),
    operationId: "b".repeat(128),
    profileId: "c".repeat(128),
    approvedRevision: Number.MAX_SAFE_INTEGER,
  };
  expect(profilePublicationInstanceId(p).length).toBeLessThanOrEqual(100);
  expect(profilePublicationInstanceId(p)).toBe(profilePublicationInstanceId({ ...p }));
  expect(profilePublicationInstanceId({ ...p, approvedRevision: 1 })).not.toBe(
    profilePublicationInstanceId(p),
  );
});
test("actual approved source copies in bounded Workflow steps before final pointer and cached replay costs nothing", async () => {
  const f = await fixture();
  await f.dispatcher.dispatch();
  const results = new Map<string, unknown>();
  const names: string[] = [];
  const step = {
    async do(name: string, options: unknown, callback: () => Promise<unknown>) {
      expect(options).toEqual({ retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" });
      if (results.has(name)) return results.get(name);
      names.push(name);
      const result = await callback();
      results.set(name, result);
      return result;
    },
  } as unknown as Pick<WorkflowStep, "do">;
  expect(await runProfilePublicationSteps(f.execution(), step)).toEqual({ status: "published" });
  expect(names).toEqual([
    "verify approved sources",
    "copy approved asset 0",
    "publish approved profile",
  ]);
  expect(f.count()).toBe(1);
  expect((await f.repository.publicProfile(f.profileId))?.approvedRevision).toBe(2);
  expect(JSON.stringify([...results.values()])).not.toContain(f.owner.userId);
  expect(JSON.stringify([...results.values()])).not.toContain("contentHash");
  expect(await runProfilePublicationSteps(f.execution(), step)).toEqual({ status: "published" });
  expect(f.count()).toBe(1);
});
test("missing trusted admission and R2 ambiguity stop as typed pending without automatic retry", async () => {
  const f = await fixture();
  await f.dispatcher.dispatch();
  const missing = createProfilePublicationExecution(
    f.core,
    { publicBucket: f.deps.publicBucket, openSanitized: f.deps.openSanitized },
    f.params,
    profilePublicationInstanceId(f.params),
  );
  expect(await missing.initialize()).toEqual({ status: "ready", assetCount: 1 });
  expect(await missing.copyAsset(0)).toEqual({
    status: "pending",
    reason: "capability_unavailable",
  });
  expect(f.count()).toBe(0);
  f.rejectPut();
  expect(await f.execution().copyAsset(0)).toEqual({
    status: "pending",
    reason: "copy_unverified",
  });
  expect(f.count()).toBe(1);
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
});
test("wrong Workflow identity and post-initialize withdrawal stop before copy", async () => {
  const f = await fixture();
  await f.dispatcher.dispatch();
  expect(() =>
    createProfilePublicationExecution(f.core, f.deps, f.params, "synthetic_wrong_instance"),
  ).toThrow("NOT_FOUND");
  expect(await f.execution().initialize()).toEqual({ status: "ready", assetCount: 1 });
  f.db.sqlite
    .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
    .run(f.owner.userId);
  expect(await f.execution().copyAsset(0)).toEqual({ status: "stopped" });
  expect(await f.execution().finalize()).toEqual({ status: "stopped" });
  expect(f.count()).toBe(0);
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
});
