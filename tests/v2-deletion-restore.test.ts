import { afterEach, expect, test } from "bun:test";
import {
  createIsolatedV2JournalManifest,
  prepareIsolatedV2Replay,
} from "../scripts/deletion-journal";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import {
  exportV2RestoreJournal,
  prepareV2RestoreReplay,
  replayV2RestoreJournal,
  v2RestoreJournalSchema,
} from "../src/server/modules/deletion/restore";
import {
  type CleanupFailureEvent,
  createV2DeletionReconciler,
  stopLegacyContainer,
} from "../src/server/modules/deletion/v2-reconcile";
import { createTestDatabase } from "./helpers/d1";
import { fixture, uploaded } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

const restored: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of restored.splice(0)) db.close();
});
const missing = {
  get: async () => {
    throw new Error("instance.not_found");
  },
};
const resource = {
  environment: "isolated-test" as const,
  syntheticOnly: true as const,
  databaseId: "11111111-1111-4111-8111-111111111111",
  databaseName: "baro-drill-restore",
  workerName: "baro-drill-restore",
  workflowName: "baro-drill-restore",
};
async function recovery() {
  const f = await fixture();
  await uploaded(f);
  const peer = await seedTestSession(f.db, { consent: true });
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
    .run(`account-type:${f.actor.ownerId}`, "customer");
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
    .run(`account-type:${peer.userId}`, "lawyer");
  const backup = f.db.sqlite.serialize();
  await uploaded(f, new TextEncoder().encode("synthetic post-backup original"));
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  const journal = await exportV2RestoreJournal(f.core);
  const db = await createTestDatabase({ snapshot: backup });
  restored.push(db);
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher);
  const now = new Date(Date.now() + 1000).toISOString();
  return {
    f,
    peer,
    journal,
    db,
    core,
    options: { trafficClosed: true as const, environment: "preview" as const, now },
  };
}

test("v2 restore replays post-backup objects, removes restored account/session, retries partial delete and preserves peers", async () => {
  const r = await recovery();
  expect(r.journal.blobs).toHaveLength(2);
  expect(await replayV2RestoreJournal(r.core, r.journal, r.options)).toMatchObject({
    trafficMustRemainClosed: true,
  });
  expect(
    r.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(r.f.actor.ownerId),
  ).toEqual({ n: 0 });
  expect(
    r.db.sqlite.query("SELECT count(*) n FROM session WHERE user_id=?").get(r.f.actor.ownerId),
  ).toEqual({ n: 0 });
  expect(
    r.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key=?")
      .get(`account-type:${r.f.actor.ownerId}`),
  ).toEqual({ n: 0 });
  expect(
    r.db.sqlite
      .query("SELECT value FROM app_metadata WHERE key=?")
      .get(`account-type:${r.peer.userId}`),
  ).toEqual({ value: "lawyer" });
  expect(r.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(r.peer.userId)).toEqual({
    n: 1,
  });
  expect(r.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE state='deleting'").get()).toEqual(
    { n: 2 },
  );
  const events: CleanupFailureEvent[] = [];
  let at = r.options.now;
  const runner = createV2DeletionReconciler(r.core, {
    environment: "preview",
    privateBucket: r.f.bucket.port,
    workflows: [missing, missing, missing, missing],
    stopProbe: async () => {},
    clock: () => at,
    testOnlyUnmeteredStorage: true,
    onFailure: (event) => events.push(event),
  });
  r.f.bucket.setDeleteFails(true);
  expect((await runner.run()).retry).toBeGreaterThan(0);
  expect(r.f.bucket.objects.size).toBe(2);
  expect(events.some((e) => e.reason === "CLEANUP_DEPENDENCY_UNAVAILABLE")).toBe(true);
  expect(JSON.stringify(events)).not.toContain(r.f.actor.ownerId);
  r.f.bucket.setDeleteFails(false);
  for (let i = 0; i < 12; i++) {
    at = new Date(Date.parse(at) + 61000).toISOString();
    await runner.run();
  }
  expect(r.f.bucket.objects.size).toBe(0);
  expect(
    r.db.sqlite.query("SELECT count(*) n FROM v2_deletion_journals WHERE state!='completed'").get(),
  ).toEqual({ n: 0 });
  expect(
    r.db.sqlite
      .query("SELECT count(*) n FROM v2_storage_reservations WHERE state!='released'")
      .get(),
  ).toEqual({ n: 0 });
  // A second restore can reintroduce object bytes. Old receipts must not be reused.
  for (const b of r.journal.blobs) r.f.bucket.objects.set(b.object_key, new Uint8Array(1));
  await replayV2RestoreJournal(r.core, r.journal, { ...r.options, now: at });
  expect(r.db.sqlite.query("SELECT count(*) n FROM v2_cleanup_receipts").get()).toEqual({ n: 0 });
  await replayV2RestoreJournal(r.core, r.journal, { ...r.options, now: at });
  for (let i = 0; i < 12; i++) {
    at = new Date(Date.parse(at) + 61000).toISOString();
    await runner.run();
  }
  expect(r.f.bucket.objects.size).toBe(0);
  expect(
    r.db.sqlite
      .query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage WHERE principal_id=?")
      .get(r.journal.reservations[0]?.principal_id ?? "missing"),
  ).toEqual({ stored_bytes: 0, reserved_bytes: 0 });
});

test("v2 inventory conflicts and injected import failure roll back the entire restore", async () => {
  const r = await recovery();
  const wrong = structuredClone(r.journal);
  const first = wrong.blobs.find((b) =>
    r.db.sqlite.query("SELECT id FROM v2_blobs WHERE id=?").get(b.id),
  );
  if (!first) throw new Error("Synthetic blob missing");
  first.object_key = "private/synthetic-conflicting-key";
  await expect(replayV2RestoreJournal(r.core, wrong, r.options)).rejects.toThrow();
  expect(
    r.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(r.f.actor.ownerId),
  ).toEqual({ n: 1 });
  expect(r.db.sqlite.query("SELECT count(*) n FROM v2_tombstones").get()).toEqual({ n: 0 });
  r.db.sqlite.exec(
    "CREATE TRIGGER synthetic_restore_failure BEFORE INSERT ON v2_deletion_targets BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(replayV2RestoreJournal(r.core, r.journal, r.options)).rejects.toThrow();
  expect(
    r.db.sqlite.query("SELECT count(*) n FROM user WHERE id=?").get(r.f.actor.ownerId),
  ).toEqual({ n: 1 });
  expect(r.db.sqlite.query("SELECT count(*) n FROM v2_tombstones").get()).toEqual({ n: 0 });
});

test("v2 restore refuses traffic-open, incomplete inventory, plaintext and stale/mismatched isolated manifests", async () => {
  const r = await recovery();
  expect(() =>
    prepareV2RestoreReplay(r.journal, { ...r.options, trafficClosed: false as unknown as true }),
  ).toThrow("RESTORE_TRAFFIC_MUST_REMAIN_CLOSED");
  expect(v2RestoreJournalSchema.safeParse({ ...r.journal, blobs: [] }).success).toBe(false);
  expect(v2RestoreJournalSchema.safeParse({ ...r.journal, plaintext: "forbidden" }).success).toBe(
    false,
  );
  const content = {
    version: 2 as const,
    candidateSha: "a".repeat(40),
    resource,
    exportedAt: r.options.now,
    journal: r.journal,
  };
  const manifest = await createIsolatedV2JournalManifest(content);
  const expected = {
    resource,
    candidateSha: content.candidateSha,
    exportedNotBefore: r.options.now,
    now: r.options.now,
    trafficClosed: true,
    targetEnvironment: "preview",
  };
  const prepared = await prepareIsolatedV2Replay(manifest, expected);
  expect(prepared).toContain("v2_deletion_targets");
  expect(prepared).not.toContain(manifest.checksumSha256);
  expect(
    await prepareIsolatedV2Replay(manifest, { ...expected, inventoryHash: "c".repeat(64) }),
  ).toContain("c".repeat(64));
  const reordered = await createIsolatedV2JournalManifest({
    ...content,
    journal: {
      ...r.journal,
      blobs: [...r.journal.blobs].reverse(),
      targets: [...r.journal.targets].reverse(),
    },
  });
  expect(reordered.checksumSha256).toBe(manifest.checksumSha256);
  await expect(
    prepareIsolatedV2Replay({ ...manifest, checksumSha256: "b".repeat(64) }, expected),
  ).rejects.toThrow("JOURNAL_CHECKSUM_MISMATCH");
  await expect(
    prepareIsolatedV2Replay(manifest, { ...expected, candidateSha: "b".repeat(40) }),
  ).rejects.toThrow("JOURNAL_SCOPE_MISMATCH");
  await expect(
    prepareIsolatedV2Replay(manifest, { ...expected, now: "2026-10-01T00:00:00.000Z" }),
  ).rejects.toThrow("JOURNAL_EXPORT_OUTSIDE_WINDOW");
  await expect(
    prepareIsolatedV2Replay(manifest, {
      ...expected,
      resource: { ...resource, databaseId: "e8cdcf75-5bd8-469e-848e-f31816df4327" },
    }),
  ).rejects.toThrow();
});

test("legacy Container stop uses the exact runtime name and never acknowledges a failed stop", async () => {
  const id = `${crypto.randomUUID()}-1`;
  const names: string[] = [];
  let fail = true;
  const binding = {
    idFromName: (name: string) => {
      names.push(name);
      return name;
    },
    get: () => ({
      stop: async (signal: string) => {
        expect(signal).toBe("SIGKILL");
        if (fail) throw new Error("synthetic private provider error");
      },
    }),
  } as unknown as Env["FILE_PROCESSOR"];
  await expect(stopLegacyContainer(binding, id)).rejects.toThrow();
  fail = false;
  expect(await stopLegacyContainer(binding, id)).toBe(true);
  expect(names).toEqual([id, id]);
  expect(await stopLegacyContainer(binding, "untracked-runtime")).toBe(false);
  expect(await stopLegacyContainer(undefined, id)).toBe(false);
});

test("restored physical inventory remains held while an actual writer is unresolved", async () => {
  const r = await recovery();
  const b = r.journal.blobs[0];
  if (!b) throw new Error("Synthetic blob missing");
  const input = {
    ...r.journal,
    bindings: r.journal.blobs.map((blob) => ({
      blob_id: blob.id,
      environment: "preview" as const,
      owner_id: r.f.actor.ownerId,
      object_key: blob.object_key,
      maximum_cipher_bytes: 1024,
      writer_state: blob.id === b.id ? ("running" as const) : ("stopped" as const),
      writer_token: blob.id === b.id ? crypto.randomUUID() : null,
      expected_cipher_bytes: blob.id === b.id ? 100 : null,
      inventory_hash: "a".repeat(64),
      created_at: blob.created_at,
    })),
  };
  r.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000)",
    )
    .run();
  await replayV2RestoreJournal(r.core, input, r.options);
  await replayV2RestoreJournal(r.core, input, r.options);
  expect(
    r.db.sqlite
      .query("SELECT held_bytes FROM v2_physical_storage_capacity WHERE environment='preview'")
      .get(),
  ).toEqual({ held_bytes: 2048 });
  const events: CleanupFailureEvent[] = [];
  const runner = createV2DeletionReconciler(r.core, {
    environment: "preview",
    privateBucket: r.f.bucket.port,
    workflows: [missing, missing, missing, missing],
    testOnlyUnmeteredStorage: true,
    clock: () => r.options.now,
    onFailure: (e) => events.push(e),
  });
  await runner.run();
  expect(r.f.bucket.objects.has(b.object_key)).toBe(true);
  expect(
    r.db.sqlite
      .query(
        "SELECT writer_state,state,released_receipt_id FROM v2_physical_blob_bindings WHERE blob_id=?",
      )
      .get(b.id),
  ).toEqual({ writer_state: "running", state: "held", released_receipt_id: null });
  expect(events.some((e) => e.reason === "CLEANUP_WRITER_OR_BUDGET_PENDING")).toBe(true);
  const settled = structuredClone(input);
  const writer = settled.bindings.find((row) => row.blob_id === b.id);
  if (!writer) throw new Error("Synthetic writer missing");
  writer.writer_state = "stopped";
  // A separately released physical binding cannot be rearmed by an older export.
  await expect(replayV2RestoreJournal(r.core, settled, r.options)).rejects.toThrow();
  expect(
    r.db.sqlite
      .query("SELECT writer_state FROM v2_physical_blob_bindings WHERE blob_id=?")
      .get(b.id),
  ).toEqual({ writer_state: "running" });
});

test("legacy stop failure stays retryable; safe failure events cannot disclose provider errors or disrupt cleanup", async () => {
  const r = await recovery();
  await replayV2RestoreJournal(r.core, r.journal, r.options);
  const journal = r.db.sqlite
    .query("SELECT id FROM v2_deletion_journals WHERE target_kind='account'")
    .get() as { id: string };
  const id = `${crypto.randomUUID()}-1`;
  r.db.sqlite
    .query(
      "INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) VALUES(?,999,'job',?)",
    )
    .run(journal.id, id);
  let fail = true;
  let at = r.options.now;
  const events: CleanupFailureEvent[] = [];
  const binding = {
    idFromName: (name: string) => name,
    get: () => ({
      stop: async () => {
        if (fail) throw new Error("secret-provider-message-and-sql");
      },
    }),
  } as unknown as Env["FILE_PROCESSOR"];
  const runner = createV2DeletionReconciler(r.core, {
    environment: "preview",
    privateBucket: r.f.bucket.port,
    workflows: [missing, missing, missing, missing],
    clock: () => at,
    testOnlyUnmeteredStorage: true,
    confirmAbsentJob: (runtime) => stopLegacyContainer(binding, runtime),
    onFailure: (e) => {
      events.push(e);
      throw new Error("synthetic logger failure");
    },
  });
  expect((await runner.run()).retry).toBeGreaterThan(0);
  expect(
    r.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(id),
  ).toEqual({ state: "pending" });
  expect(JSON.stringify(events)).not.toContain("secret-provider");
  expect(JSON.stringify(events)).not.toContain(id);
  expect(
    events.some((e) => e.attempts === 1 && e.reason === "CLEANUP_DEPENDENCY_UNAVAILABLE"),
  ).toBe(true);
  fail = false;
  at = new Date(Date.parse(at) + 61000).toISOString();
  await runner.run();
  expect(
    r.db.sqlite.query("SELECT state FROM v2_deletion_targets WHERE target_id=?").get(id),
  ).toEqual({ state: "completed" });
});

test("a partial upload restored from an older backup uses the latest hash before fresh negative HEAD", async () => {
  const r = await recovery();
  const b = r.journal.blobs[0];
  if (!b) throw new Error("Synthetic blob missing");
  r.db.sqlite
    .query("UPDATE v2_blobs SET cipher_hash=NULL,cipher_bytes=0,state='pending' WHERE id=?")
    .run(b.id);
  await replayV2RestoreJournal(r.core, r.journal, r.options);
  expect(
    r.db.sqlite.query("SELECT cipher_hash,cipher_bytes FROM v2_blobs WHERE id=?").get(b.id),
  ).toEqual({ cipher_hash: b.cipher_hash, cipher_bytes: b.cipher_bytes });
  let at = r.options.now;
  const runner = createV2DeletionReconciler(r.core, {
    environment: "preview",
    privateBucket: r.f.bucket.port,
    workflows: [missing, missing, missing, missing],
    testOnlyUnmeteredStorage: true,
    clock: () => at,
    onFailure: () => {},
  });
  for (let i = 0; i < 12; i++) {
    await runner.run();
    at = new Date(Date.parse(at) + 61000).toISOString();
  }
  expect(r.f.bucket.objects.size).toBe(0);
});
