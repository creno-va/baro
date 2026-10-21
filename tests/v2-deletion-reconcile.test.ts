import { expect, test } from "bun:test";
import { deleteAccount } from "../src/server/modules/deletion/service";
import { createV2DeletionReconciler } from "../src/server/modules/deletion/v2-reconcile";
import { profilePublicationInstanceId } from "../src/server/modules/lawyers/publication-execution";
import { r2 } from "./helpers/file-processing-fixture";
import { publicationFixture } from "./helpers/lawyer-publication";
import { readyFile, reportFixture } from "./helpers/report-fixture";
import { admit, HASH, held, intent, NOW, ready } from "./helpers/storage-capacity";
import {
  deletedCleanupResult,
  missingCleanupWorkflow as missing,
} from "./helpers/workflow-cleanup";

test("actual physical writer and exhausted cleanup allowance prevent any R2 delete; expired lease cannot issue a receipt", async () => {
  const f = await ready({ deleteLimit: 5, headLimit: 5 }),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const writer = await f.capacity.beginWrite(i.id, 100, NOW);
  if (!writer) throw new Error("synthetic writer missing");
  f.db.sqlite
    .query("UPDATE v2_blobs SET cipher_hash=?,cipher_bytes=100 WHERE id=?")
    .run(HASH, i.id);
  const bucket = r2();
  bucket.objects.set(i.input.objectKey, new Uint8Array(100));
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  let at = new Date().toISOString();
  const deps = {
    environment: "preview" as const,
    privateBucket: bucket.port,
    workflows: [missing, missing, missing, missing],
    clock: () => at,
  };
  const runner = createV2DeletionReconciler(f.core, deps);
  expect((await runner.run()).retry).toBeGreaterThan(0);
  expect(bucket.calls.delete).toBe(0);
  expect(held(f).held_bytes).toBe(100);
  expect(
    await f.capacity.confirmWriterStopped(
      writer,
      { transport: "response", objectKey: writer.objectKey, byteLength: 100 },
      at,
    ),
  ).toBe(true);
  at = new Date(Date.parse(at) + 61000).toISOString();
  // Inject a response arriving after its cleanup lease expired. The real object
  // is gone, but a stale lease cannot mark inventory/capacity as confirmed.
  let expire = true;
  const port = {
    ...bucket.port,
    delete: async (key: string) => {
      await bucket.port.delete(key);
      if (expire) {
        expire = false;
        at = new Date(Date.parse(at) + 61000).toISOString();
      }
    },
  };
  const leased = createV2DeletionReconciler(f.core, { ...deps, privateBucket: port });
  expect((await leased.run()).retry).toBeGreaterThan(0);
  expect(held(f).held_bytes).toBe(100);
  for (let n = 0; n < 4; n++) {
    at = new Date(Date.parse(at) + 61000).toISOString();
    await leased.run();
  }
  expect(held(f).held_bytes).toBe(0);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE state='pending'").get(),
  ).toEqual({ n: 0 });
  const exhausted = await ready({ deleteLimit: 0 }),
    empty = await intent(exhausted);
  expect(await admit(exhausted, empty)).toBe(true);
  exhausted.db.sqlite.query("DELETE FROM user WHERE id=?").run(exhausted.actor.ownerId);
  const denied = r2();
  await createV2DeletionReconciler(exhausted.core, {
    ...deps,
    clock: () => new Date().toISOString(),
    privateBucket: denied.port,
  }).run();
  expect(denied.calls.delete).toBe(0);
  expect(held(exhausted).held_bytes).toBe(100);
});

test("actual journal cursor retries partial R2 deletes, releases original/report reservations once and never revives deleted content", async () => {
  const f = await reportFixture();
  await readyFile(f, "합성 삭제 대상 원본");
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  await new Response((await f.reports.pdf(f.actor.ownerId, report.id)).body).arrayBuffer();
  f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspaceId);
  let at = new Date().toISOString();
  f.bucket.setDeleteFails(true);
  const runner = createV2DeletionReconciler(f.core, {
    environment: "preview",
    privateBucket: f.bucketPort,
    workflows: [missing, missing, missing, missing],
    stopNative: async () => {},
    clock: () => at,
    testOnlyUnmeteredStorage: true,
  });
  expect((await runner.run()).retry).toBeGreaterThan(0);
  expect(f.bucket.objects.size).toBeGreaterThan(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE state='deleted'").get()).toEqual({
    n: 0,
  });
  f.bucket.setDeleteFails(false);
  for (let i = 0; i < 6; i++) {
    at = new Date(Date.parse(at) + 61000).toISOString();
    await runner.run();
  }
  expect(f.bucket.objects.size).toBe(0);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE state='pending'").get(),
  ).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
  ).toEqual({ reserved_bytes: 0, stored_bytes: 0 });
  await runner.run();
  expect(
    f.db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
  ).toEqual({ reserved_bytes: 0, stored_bytes: 0 });
  await expect(f.reports.pdf(f.actor.ownerId, report.id)).rejects.toThrow("NOT_FOUND");
});
test("account deletion captures publication runtime, clears private staging/public copies through distinct buckets and preserves uncertain stop targets", async () => {
  const f = await publicationFixture();
  await f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  f.db.sqlite
    .query("UPDATE v2_blobs SET object_key='private/'||id WHERE visibility='staging'")
    .run();
  const original = f.db.sqlite
    .query("SELECT id FROM v2_blobs WHERE visibility='staging'")
    .get() as { id: string };
  const privateKeys = new Set([`private/${original.id}`]);
  const privateBucket = {
    delete: async (key: string) => {
      expect(key.startsWith("private/")).toBe(true);
      privateKeys.delete(key);
    },
    head: async (key: string) => (privateKeys.has(key) ? { key } : null),
  } as unknown as typeof f.deps.publicBucket;
  const row = f.db.sqlite
    .query(
      "SELECT id outboxId,operation_id operationId,target_id profileId,revision approvedRevision FROM v2_outbox WHERE kind='profile_publish'",
    )
    .get() as Parameters<typeof profilePublicationInstanceId>[0];
  const runtimeId = profilePublicationInstanceId(row);
  f.db.sqlite
    .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
    .run(Date.now(), f.owner.sessionId);
  expect(await deleteAccount(f.db.binding, f.owner.userId, f.owner.sessionId, Date.now())).toBe(
    true,
  );
  expect(
    f.db.sqlite
      .query("SELECT target_id FROM v2_deletion_targets WHERE kind='job' AND target_id=?")
      .get(runtimeId),
  ).toEqual({ target_id: runtimeId });
  let fail = true,
    at = new Date().toISOString();
  const binding = {
    deleteBatch: async (ids: string[]) => {
      if (ids[0] !== runtimeId) return missing.deleteBatch(ids);
      if (fail) throw new Error("synthetic network failure");
      return deletedCleanupResult(ids);
    },
  };
  const runner = createV2DeletionReconciler(f.core, {
    environment: "preview",
    privateBucket,
    publicBucket: f.deps.publicBucket,
    workflows: [missing, missing, missing, binding],
    legacyWorkflow: missing,
    clock: () => at,
    testOnlyUnmeteredStorage: true,
  });
  expect((await runner.run()).retry).toBeGreaterThan(0);
  expect(f.objects.size).toBe(1);
  fail = false;
  for (let i = 0; i < 6; i++) {
    at = new Date(Date.parse(at) + 61000).toISOString();
    await runner.run();
  }
  expect(privateKeys.size).toBe(0);
  expect(f.objects.size).toBe(0);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_targets WHERE state='pending'").get(),
  ).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_public_assets").get()).toEqual({ n: 0 });
});
test("unknown missing legacy runtime never becomes a stop receipt; a deterministic probe uses the actual stop port", async () => {
  const f = await reportFixture();
  const journalId = crypto.randomUUID(),
    unknown = `${crypto.randomUUID()}-1`,
    probe = `probe-${crypto.randomUUID()}-1`,
    at = new Date().toISOString();
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(?,'blob',?,?,?)",
    )
    .run(journalId, crypto.randomUUID(), at, at);
  for (const [ordinal, id] of [probe, unknown].entries())
    f.db.sqlite
      .query(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,?)",
      )
      .run(journalId, id, ordinal);
  const stopped: string[] = [];
  const runner = createV2DeletionReconciler(f.core, {
    environment: "preview",
    privateBucket: f.bucketPort,
    workflows: [missing, missing, missing, missing],
    stopNative: async (id) => {
      stopped.push(id);
    },
    clock: () => at,
    testOnlyUnmeteredStorage: true,
  });
  expect((await runner.run()).retry).toBe(1);
  expect(stopped).toEqual([probe]);
  expect(
    f.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(unknown),
  ).toEqual({ state: "pending" });
});

test("Workflow absence or deletion never proves that a legacy random native process stopped", async () => {
  for (const observed of [false, true]) {
    const f = await reportFixture();
    const at = new Date().toISOString(),
      journal = crypto.randomUUID();
    f.db.sqlite
      .query(
        "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(?,'blob',?,?,?)",
      )
      .run(journal, crypto.randomUUID(), at, at);
    const ids = [`file-processing-${crypto.randomUUID()}-1`, `${crypto.randomUUID()}-1`];
    for (const [ordinal, id] of ids.entries())
      f.db.sqlite
        .query(
          "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,?)",
        )
        .run(journal, id, ordinal);
    let nativeCalls = 0;
    const found = { deleteBatch: async (ids: string[]) => deletedCleanupResult(ids) };
    const runner = createV2DeletionReconciler(f.core, {
      environment: "preview",
      workflows: [observed ? found : missing, missing, missing, missing],
      stopNative: async () => {
        nativeCalls++;
      },
      clock: () => at,
      onFailure: () => {},
      testOnlyUnmeteredStorage: true,
    });
    expect(await runner.run()).toEqual({ acquired: 1, completed: 0, retry: 1 });
    expect(nativeCalls).toBe(0);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_deletion_targets WHERE journal_id=? AND state='pending'")
        .get(journal),
    ).toEqual({ n: 2 });
  }
});

test("native revocation and Workflow stop must both succeed before the retained journal receives a receipt", async () => {
  const f = await reportFixture();
  let at = new Date().toISOString(),
    nativeFails = true,
    workflowFails = false;
  const journal = crypto.randomUUID(),
    id = `native-v1-file-${crypto.randomUUID()}-2`,
    calls: string[] = [];
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(?,'blob',?,?,?)",
    )
    .run(journal, crypto.randomUUID(), at, at);
  f.db.sqlite
    .query("INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,0)")
    .run(journal, id);
  const binding = {
    deleteBatch: async (ids: string[]) => {
      calls.push("workflow");
      if (workflowFails) throw new Error("synthetic workflow failure");
      return deletedCleanupResult(ids);
    },
  };
  const runner = createV2DeletionReconciler(f.core, {
    environment: "preview",
    workflows: [binding, missing, missing, missing],
    stopNative: async (runtime) => {
      expect(runtime).toBe(id);
      calls.push("native");
      if (nativeFails) throw new Error("synthetic native failure");
    },
    clock: () => at,
    onFailure: () => {},
    testOnlyUnmeteredStorage: true,
  });
  expect(await runner.run()).toEqual({ acquired: 1, completed: 0, retry: 1 });
  expect(calls).toEqual(["native"]);
  nativeFails = false;
  workflowFails = true;
  at = new Date(Date.parse(at) + 61000).toISOString();
  expect(await runner.run()).toEqual({ acquired: 1, completed: 0, retry: 1 });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(id),
  ).toEqual({ state: "pending" });
  workflowFails = false;
  at = new Date(Date.parse(at) + 61000).toISOString();
  expect(await runner.run()).toEqual({ acquired: 1, completed: 1, retry: 0 });
  expect(calls).toEqual(["native", "native", "workflow", "native", "workflow"]);
  expect(
    f.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(id),
  ).toEqual({ state: "completed" });
});

test("named native report cleanup revokes the renderer without requiring a Workflow instance", async () => {
  const f = await reportFixture(),
    at = new Date().toISOString(),
    journal = crypto.randomUUID(),
    id = `native-v1-report-${crypto.randomUUID()}-1`;
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(?,'blob',?,?,?)",
    )
    .run(journal, crypto.randomUUID(), at, at);
  f.db.sqlite
    .query("INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,0)")
    .run(journal, id);
  const calls: string[] = [];
  const runner = createV2DeletionReconciler(f.core, {
    environment: "preview",
    workflows: [],
    stopNative: async (runtime) => {
      calls.push(runtime);
    },
    clock: () => at,
    testOnlyUnmeteredStorage: true,
  });
  expect(await runner.run()).toEqual({ acquired: 1, completed: 1, retry: 0 });
  expect(calls).toEqual([id]);
  expect(
    f.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(id),
  ).toEqual({ state: "completed" });
});
