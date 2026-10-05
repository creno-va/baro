import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { type Actor, createV2Core } from "../src/server/db/v2-core";
import { type CleanupLease, createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-07T00:00:00.000Z";
function target(ids: string[], index: number): string {
  const id = ids[index];
  if (!id) throw new Error("MISSING_SYNTHETIC_TARGET");
  return id;
}
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const database = await createTestDatabase();
  databases.push(database);
  const session = await seedTestSession(database, {
    now: Date.parse(NOW),
    oauthAuthenticatedAt: Date.parse(NOW),
    consent: true,
  });
  const peer = await seedTestSession(database, {
    now: Date.parse(NOW),
    oauthAuthenticatedAt: Date.parse(NOW),
    consent: true,
  });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(database.binding, cipher);
  return {
    database,
    session,
    peer,
    core,
    actor: { ownerId: session.userId, now: NOW } satisfies Actor,
    deletion: createV2DeletionRepository(core),
    workspace: createV2WorkspaceRepository(database.binding, cipher),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function workspace(f: Fixture, ownerId = f.actor.ownerId) {
  const id = crypto.randomUUID();
  expect(
    (
      await f.workspace.create(
        { ownerId, now: NOW },
        id,
        {
          narrative: "삭제 저장소를 검증하는 합성 사건입니다.",
          subjectContext: "individual",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      )
    ).kind,
  ).toBe("created");
  return id;
}
function count(f: Fixture, table: string) {
  return (f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}
async function deletedWorkspace(f: Fixture, targets = 2) {
  const id = await workspace(f);
  expect(await f.deletion.workspace({ ...f.actor, workspaceId: id, expectedRevision: 1 })).toBe(
    true,
  );
  const journal = await f.deletion.findByTarget("workspace", id);
  expect(journal).not.toBeNull();
  if (!journal) throw new Error("MISSING_SYNTHETIC_JOURNAL");
  // Synthetic opaque workflow inventory exercises real journal/receipt SQL. No live cancellation is claimed.
  const targetIds = Array.from({ length: targets }, () => crypto.randomUUID());
  for (const [ordinal, target] of targetIds.entries()) {
    f.database.sqlite
      .query(
        "INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) VALUES(?,?,'job',?)",
      )
      .run(journal.id, ordinal, target);
  }
  return { id, journal, targetIds };
}
async function lease(f: Fixture, journalId: string, now = NOW) {
  const result = await f.deletion.acquire(
    journalId,
    crypto.randomUUID(),
    now,
    new Date(Date.parse(now) + 120000).toISOString(),
  );
  expect(result).not.toBeNull();
  if (!result) throw new Error("MISSING_SYNTHETIC_LEASE");
  return result;
}
function targetStates(f: Fixture, journalId: string) {
  return f.database.sqlite
    .query("SELECT ordinal,state FROM v2_deletion_targets WHERE journal_id=? ORDER BY ordinal")
    .all(journalId);
}

test("workspace deletion witnesses outer delete, preserves another owner and denies stale owner/revision", async () => {
  const f = await fixture();
  const id = await workspace(f);
  const other = await workspace(f, f.peer.userId);
  const g = { ...f.actor, workspaceId: id, expectedRevision: 1 };
  expect(await f.deletion.workspace({ ...g, ownerId: f.peer.userId })).toBe(false);
  expect(await f.deletion.workspace({ ...g, expectedRevision: 2 })).toBe(false);
  expect(count(f, "v2_tombstones")).toBe(0);
  expect(await f.deletion.workspace(g)).toBe(true);
  expect(await f.deletion.workspace(g)).toBe(false);
  expect(count(f, "v2_workspaces")).toBe(1);
  expect(
    f.database.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(other),
  ).not.toBeNull();
  expect(await f.deletion.findByTarget("workspace", id)).not.toBeNull();
  expect(
    f.database.sqlite
      .query("SELECT target_id FROM v2_tombstones WHERE target_kind='workspace'")
      .all(),
  ).toEqual([{ target_id: id }]);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("journal insert failure atomically preserves workspace and removes partial tombstone", async () => {
  const f = await fixture();
  const id = await workspace(f);
  f.database.sqlite.exec(
    "CREATE TRIGGER test_abort_v2_journal BEFORE INSERT ON v2_deletion_journals BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
  );
  await expect(
    f.deletion.workspace({ ...f.actor, workspaceId: id, expectedRevision: 1 }),
  ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
  expect(count(f, "v2_workspaces")).toBe(1);
  expect(count(f, "v2_tombstones")).toBe(0);
  expect(count(f, "v2_deletion_journals")).toBe(0);
});

test("account deletion requires owner session, nonexpired session and recent nonfuture OAuth", async () => {
  const f = await fixture();
  await workspace(f);
  const other = await workspace(f, f.peer.userId);
  expect(await f.deletion.account(f.actor, f.peer.sessionId)).toBe(false);
  for (const authTime of [Date.parse(NOW) - 600001, Date.parse(NOW) + 1, null]) {
    f.database.sqlite
      .query("UPDATE session SET oauth_authenticated_at=? WHERE id=?")
      .run(authTime, f.session.sessionId);
    expect(await f.deletion.account(f.actor, f.session.sessionId)).toBe(false);
  }
  f.database.sqlite
    .query("UPDATE session SET oauth_authenticated_at=?,expires_at=? WHERE id=?")
    .run(Date.parse(NOW), Date.parse(NOW), f.session.sessionId);
  expect(await f.deletion.account(f.actor, f.session.sessionId)).toBe(false);
  expect(count(f, "user")).toBe(2);
  expect(count(f, "v2_tombstones")).toBe(0);
  f.database.sqlite
    .query("UPDATE session SET expires_at=? WHERE id=?")
    .run(Date.parse(NOW) + 1, f.session.sessionId);
  expect(await f.deletion.account(f.actor, f.session.sessionId)).toBe(true);
  expect(count(f, "user")).toBe(1);
  expect(
    f.database.sqlite.query("SELECT id FROM session WHERE user_id=?").all(f.session.userId),
  ).toEqual([]);
  expect(
    f.database.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(other),
  ).not.toBeNull();
  expect(await f.deletion.findByTarget("account", f.actor.ownerId)).not.toBeNull();
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("cleanup acquisition is fenced, bounded and restartable; no early finish with pending targets", async () => {
  const f = await fixture();
  const d = await deletedWorkspace(f);
  const first = await lease(f, d.journal.id);
  expect(
    await f.deletion.acquire(d.journal.id, crypto.randomUUID(), NOW, "2026-10-07T00:06:00Z"),
  ).toBeNull();
  expect(
    await f.deletion.acquire(d.journal.id, crypto.randomUUID(), NOW, "2026-10-07T00:01:00Z"),
  ).toBeNull();
  expect(await f.deletion.targets(first, NOW, 1)).toHaveLength(1);
  expect(await f.deletion.finish(first, NOW)).toBe(false);
  const late = "2026-10-07T00:02:00.001Z";
  const second = await lease(f, d.journal.id, late);
  expect(second.fencing).toBe(first.fencing + 1);
  expect(await f.deletion.targets(first, late)).toEqual([]);
  expect(await f.deletion.fail(first, late, late)).toBe(false);
  expect(await f.deletion.fail(second, late, "2026-10-07T00:03:00Z")).toBe(true);
  expect(await f.deletion.pending(late)).toEqual([]);
  expect(await f.deletion.pending("2026-10-07T00:03:00Z")).toHaveLength(1);
});

test("successful receipts are target scoped and replay does not advance cursor twice", async () => {
  const f = await fixture();
  const d = await deletedWorkspace(f);
  const l = await lease(f, d.journal.id);
  const receiptId = crypto.randomUUID();
  const input = { receiptId, kind: "job" as const, targetId: target(d.targetIds, 0), now: NOW };
  expect(await f.deletion.recordReceipt(l, input)).toBe(true);
  expect(await f.deletion.recordReceipt(l, input)).toBe(false);
  expect((await f.deletion.findByTarget("workspace", d.id))?.cursor).toBe(1);
  expect(await f.deletion.finish(l, NOW)).toBe(false);
  expect(
    await f.deletion.recordReceipt(l, {
      ...input,
      receiptId: crypto.randomUUID(),
      targetId: target(d.targetIds, 1),
    }),
  ).toBe(true);
  expect(await f.deletion.finish(l, NOW)).toBe(true);
  expect(await f.deletion.targets(l, NOW)).toEqual([]);
  expect((await f.deletion.findByTarget("workspace", d.id))?.state).toBe("completed");
  expect(count(f, "v2_cleanup_receipts")).toBe(2);
});

test("invalid cleanup lease cannot use an existing receipt to complete a different target", async () => {
  const f = await fixture();
  const d = await deletedWorkspace(f);
  const l = await lease(f, d.journal.id);
  const receiptId = crypto.randomUUID();
  expect(
    await f.deletion.recordReceipt(l, {
      receiptId,
      kind: "job",
      targetId: target(d.targetIds, 0),
      now: NOW,
    }),
  ).toBe(true);
  const before = targetStates(f, d.journal.id);
  const invalid: CleanupLease = { ...l, token: crypto.randomUUID() };
  expect(
    await f.deletion.recordReceipt(invalid, {
      receiptId,
      kind: "job",
      targetId: target(d.targetIds, 1),
      now: NOW,
    }),
  ).toBe(false);
  expect(targetStates(f, d.journal.id)).toEqual(before);
  expect((await f.deletion.findByTarget("workspace", d.id))?.cursor).toBe(1);
  expect(await f.deletion.finish(l, NOW)).toBe(false);
});

test("a receipt from another journal cannot mutate a pending target through a foreign lease", async () => {
  const f = await fixture();
  const a = await deletedWorkspace(f, 1);
  const b = await deletedWorkspace(f, 1);
  const l = await lease(f, a.journal.id);
  const receiptId = crypto.randomUUID();
  expect(
    await f.deletion.recordReceipt(l, {
      receiptId,
      kind: "job",
      targetId: target(a.targetIds, 0),
      now: NOW,
    }),
  ).toBe(true);
  const forged = { journalId: b.journal.id, token: crypto.randomUUID(), fencing: 1 };
  expect(
    await f.deletion.recordReceipt(forged, {
      receiptId,
      kind: "job",
      targetId: target(b.targetIds, 0),
      now: NOW,
    }),
  ).toBe(false);
  expect(targetStates(f, b.journal.id)).toEqual([{ ordinal: 0, state: "pending" }]);
  expect(count(f, "v2_cleanup_receipts")).toBe(1);
});

async function emptyReservation(f: Fixture) {
  const id = await workspace(f);
  const operation = f.database.sqlite
    .query("SELECT id FROM v2_operations WHERE workspace_id=?")
    .get(id) as { id: string };
  const reservationId = crypto.randomUUID();
  const storage = createV2StorageRepository(f.core);
  // Real DB admission before an upload starts; the object inventory is synthetic, not R2 evidence.
  expect(
    await storage.reserve(
      { ...f.actor, workspaceId: id, expectedRevision: 1 },
      {
        id: reservationId,
        kind: "case_original",
        caseId: id,
        fileId: crypto.randomUUID(),
        byteLength: 100,
        state: "reserved",
      },
      operation.id,
    ),
  ).toBe(true);
  expect(await f.deletion.workspace({ ...f.actor, workspaceId: id, expectedRevision: 2 })).toBe(
    true,
  );
  const journal = await f.deletion.findByTarget("workspace", id);
  if (!journal) throw new Error("MISSING_SYNTHETIC_JOURNAL");
  return { id, reservationId, storage, journal, lease: await lease(f, journal.id) };
}
function reservedBytes(f: Fixture) {
  return (
    f.database.sqlite
      .query(
        "SELECT reserved_bytes AS n FROM v2_storage_usage WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)",
      )
      .get(f.actor.ownerId) as { n: number }
  ).n;
}

test("empty upload reservation needs matching lease and stopped jobs; receipt releases storage once", async () => {
  const f = await fixture();
  const d = await emptyReservation(f);
  const input = {
    receiptId: crypto.randomUUID(),
    reservationId: d.reservationId,
    now: NOW,
    inventoryVerified: true as const,
  };
  const jobId = crypto.randomUUID();
  f.database.sqlite
    .query("INSERT INTO v2_deletion_targets(journal_id,ordinal,kind,target_id) VALUES(?,1,'job',?)")
    .run(d.journal.id, jobId);
  expect(reservedBytes(f)).toBe(100);
  expect(await d.storage.confirmEmptyReservation(d.lease, input)).toBe(false);
  expect(
    await d.storage.confirmEmptyReservation({ ...d.lease, token: crypto.randomUUID() }, input),
  ).toBe(false);
  expect(reservedBytes(f)).toBe(100);
  expect(count(f, "v2_cleanup_receipts")).toBe(0);
  expect(
    await f.deletion.recordReceipt(d.lease, {
      receiptId: crypto.randomUUID(),
      kind: "job",
      targetId: jobId,
      now: NOW,
    }),
  ).toBe(true);
  await expect(
    d.storage.confirmEmptyReservation(d.lease, { ...input, inventoryVerified: false as never }),
  ).rejects.toMatchObject({ code: "REPOSITORY_INPUT_INVALID" });
  expect(reservedBytes(f)).toBe(100);
  expect(await d.storage.confirmEmptyReservation(d.lease, input)).toBe(true);
  expect(reservedBytes(f)).toBe(0);
  expect(await d.storage.confirmEmptyReservation(d.lease, input)).toBe(false);
  expect(reservedBytes(f)).toBe(0);
  expect(count(f, "v2_cleanup_receipts")).toBe(2);
  expect(await f.deletion.finish(d.lease, NOW)).toBe(true);
});

test("reservation release failure rolls back durable receipt, target and storage counter together", async () => {
  const f = await fixture();
  const d = await emptyReservation(f);
  f.database.sqlite.exec(
    "CREATE TRIGGER test_abort_release BEFORE UPDATE OF state ON v2_storage_reservations WHEN NEW.state='released' BEGIN SELECT RAISE(ABORT,'synthetic release rollback'); END;",
  );
  await expect(
    d.storage.confirmEmptyReservation(d.lease, {
      receiptId: crypto.randomUUID(),
      reservationId: d.reservationId,
      now: NOW,
      inventoryVerified: true,
    }),
  ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
  expect(reservedBytes(f)).toBe(100);
  expect(count(f, "v2_cleanup_receipts")).toBe(0);
  expect(targetStates(f, d.journal.id)).toEqual([{ ordinal: 0, state: "pending" }]);
  expect(
    f.database.sqlite
      .query("SELECT state FROM v2_storage_reservations WHERE id=?")
      .get(d.reservationId),
  ).toEqual({ state: "reserved" });
  expect(await f.deletion.finish(d.lease, NOW)).toBe(false);
});
