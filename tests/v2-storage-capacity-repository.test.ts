import { expect, test } from "bun:test";
import {
  createV2StorageCapacityRepository,
  isPreparedPhysicalCapacity,
} from "../src/server/db/v2-storage-capacity";
import {
  admit,
  allocation,
  deleteActual,
  EXP,
  fixture,
  HASH,
  held,
  intent,
  LATER,
  NOW,
  projection,
  ready,
  verifier,
} from "./helpers/storage-capacity";

test("authenticated projection reserves exact estimates without fabricating a settled bill; repeats never reset counters", async () => {
  const f = await ready();
  const m = f.db.sqlite
    .query("SELECT state,amount_krw FROM v2_maintenance_exposure WHERE id=?")
    .get(f.p.id) as { state: string; amount_krw: number };
  expect(m.state).toBe("reserved");
  expect(m.amount_krw).toBeGreaterThan(0);
  expect(await f.capacity.reserveProjection(f.p, NOW)).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_maintenance_exposure").get()).toEqual({
    n: 1,
  });
});
test("missing verifier and stale control/proof/configuration fail closed", async () => {
  const f = await fixture(),
    capacity = createV2StorageCapacityRepository(f.core, "preview", verifier);
  expect(await f.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  expect(
    await createV2StorageCapacityRepository(f.core, "preview").reserveProjection(
      projection(f),
      NOW,
    ),
  ).toBe(false);
  expect(
    await capacity.reserveProjection(projection(f, { expectedControlRevision: 99 }), NOW),
  ).toBe(false);
  const short = { ...f.fp, id: crypto.randomUUID(), validUntil: LATER };
  expect(await f.runtime.putFundingProof(short, NOW)).toBe(true);
  expect(await capacity.reserveProjection(projection(f, { fundingProofId: short.id }), NOW)).toBe(
    false,
  );
  expect(held(f)).toBeNull();
});
test("maximum is 100GB physical cipher capacity, pending claim rollback is atomic and non-forgeable", async () => {
  const f = await ready(),
    i = await intent(f);
  const p = f.capacity.prepareCapacity(f.actor, i.input);
  expect(isPreparedPhysicalCapacity(p)).toBe(true);
  expect(isPreparedPhysicalCapacity({ ...p })).toBe(false);
  await expect(admit(f, i, false)).rejects.toThrow();
  expect(held(f)).toEqual({ held_bytes: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
  expect(await admit(f, i)).toBe(true);
  expect(held(f)).toEqual({ held_bytes: 100 });
  expect(() =>
    f.capacity.prepareCapacity(f.actor, { ...i.input, maximumCipherBytes: 100000000001 }),
  ).toThrow();
  expect(() =>
    f.capacity.prepareCapacity(f.actor, { ...i.input, ownerId: "foreign-owner" }),
  ).toThrow();
  expect(() => p.statements(f.core, { ...f.actor, now: LATER }, crypto.randomUUID())).toThrow();
});
test("concurrent last-slot claims across original/derivative/public share one physical ceiling", async () => {
  const f = await ready({ capacityBytes: 200 }),
    a = await intent(f),
    b = await intent(f, "derivative", "staging"),
    c = await intent(f, "public_copy", "public");
  const results = await Promise.all([admit(f, a), admit(f, b), admit(f, c)]);
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(held(f)).toEqual({ held_bytes: 200 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 2 });
});
test("writer capability validates returned key/size, denies clones and never permits a second dispatch", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const w = await f.capacity.beginWrite(i.id, 100, NOW);
  expect(w).not.toBeNull();
  if (!w) throw Error("no writer");
  expect(await f.capacity.beginWrite(i.id, 100, NOW)).toBeNull();
  expect(
    await f.capacity.confirmWriterStopped(
      { ...w },
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: "private/wrong", byteLength: 100 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 99 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      NOW,
    ),
  ).toBe(true);
  expect(await f.capacity.confirmWriterStopped(w, { transport: "not_sent" }, NOW)).toBe(false);
  expect(held(f).held_bytes).toBe(100);
});
test("actual delete while writer is unresolved retains capacity; stopped writer needs a later actual delete receipt", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const w = await f.capacity.beginWrite(i.id, 100, NOW);
  if (!w) throw Error("no writer");
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(
    await f.capacity.confirmWriterStopped(
      w,
      { transport: "response", objectKey: w.objectKey, byteLength: 100 },
      LATER,
    ),
  ).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(0);
  expect(await f.capacity.beginWrite(i.id, 100, LATER)).toBeNull();
});
test("never-dispatched cancellation is safely released by actual guarded delete and cannot start later", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(0);
  expect(await f.capacity.beginWrite(i.id, 100, NOW)).toBeNull();
});
test("physical tuple is immutable; hash metadata/AES survives migration and source account removal cannot erase capacity", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  expect(() =>
    f.db.sqlite.query("UPDATE v2_blobs SET cipher_bytes=101 WHERE id=?").run(i.id),
  ).toThrow();
  expect(() =>
    f.db.sqlite.query("UPDATE v2_blobs SET object_key=? WHERE id=?").run("private/other", i.id),
  ).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM v2_physical_blob_bindings")).toThrow();
  expect(() => f.db.sqlite.exec("UPDATE v2_physical_storage_capacity SET held_bytes=0")).toThrow();
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(held(f).held_bytes).toBe(100);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("monthly bounded maintenance permits have exact scope, one use and no refundable unknown exposure", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(i.id);
  const p = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW);
  if (!p) throw Error("no get");
  expect(await f.capacity.consumeMaintenanceIO({ ...p }, NOW)).toBe(false);
  expect(await f.capacity.consumeMaintenanceIO(p, NOW)).toBe(true);
  expect(await f.capacity.consumeMaintenanceIO(p, NOW)).toBe(false);
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW)).not.toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW)).toBeNull();
  expect(
    await f.capacity.beforeMaintenanceIO({ blobId: "foreign-blob", action: "head" }, NOW),
  ).toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "delete" }, NOW)).toBeNull();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "head" }, EXP)).toBeNull();
  expect(held(f).held_bytes).toBe(100);
});
test("actual populated 0008 -> 0009 preserves session, AES ciphertext, funding and opaque physical pending; explicit inventory is required", async () => {
  const f = await fixture({ throughMigration: "0008_storage_paid_execution" }),
    i = await intent(f);
  await i.statement().run();
  const before = f.db.sqlite.query("SELECT * FROM session").all(),
    budget = f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all();
  f.db.sqlite.exec(await Bun.file("drizzle/0009_storage_capacity_maintenance.sql").text());
  expect(f.db.sqlite.query("SELECT * FROM session").all()).toEqual(before);
  expect(f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all()).toEqual(budget);
  expect(f.db.sqlite.query("SELECT encrypted_payload FROM v2_blobs WHERE id=?").get(i.id)).toEqual({
    encrypted_payload: i.encrypted,
  });
  expect(
    await f.core.cipher.decrypt(i.encrypted, {
      table: "v2_blobs",
      column: "encrypted_payload",
      rowId: i.id,
      userId: f.actor.ownerId,
      revision: 1,
    }),
  ).toBe(JSON.stringify({ contentHash: HASH }));
  expect(await f.runtime.freeze("2026-10", 3, 1, NOW)).toBe(true);
  const capacity = createV2StorageCapacityRepository(f.core, "preview", verifier);
  expect(await capacity.reserveProjection(projection(f), NOW)).toBe(false);
  expect(
    await capacity.bindInventory(
      {
        id: crypto.randomUUID(),
        manifestHash: HASH,
        observedAt: NOW,
        bindings: [{ ...i.input, writerState: "unknown" }],
      },
      NOW,
    ),
  ).toBe(true);
  expect(await capacity.reserveProjection(projection(f), NOW)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(await deleteActual(f, i.id)).toBe(true);
  expect(held(f).held_bytes).toBe(100);
});

test("full ceiling is projected for the complete KST month; monthly rollover cannot reset physical held bytes or reuse I/O permits", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const row = f.db.sqlite
    .query("SELECT payload_json,valid_until FROM v2_storage_projections")
    .get() as { payload_json: string; valid_until: string };
  const payload = JSON.parse(row.payload_json);
  expect(payload.quantities[0]).toEqual({ sku: "r2_storage_gb_months", maximumQuantity: "100" });
  expect(row.valid_until).toBe("2026-10-31T15:00:00.000Z");
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(i.id);
  const permit = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, NOW);
  if (!permit) throw Error("missing permit");
  expect(await f.capacity.consumeMaintenanceIO(permit, "2026-10-31T15:00:00.000Z")).toBe(false);
  expect(held(f).held_bytes).toBe(100);
  const a = {
    ...allocation(),
    month: "2026-11",
    reviewedAt: EXP,
    validUntil: "2026-12-01T00:00:00.000Z",
    fundingValidUntil: "2026-12-01T00:00:00.000Z",
  };
  expect(await f.accounting.recordAllocation(a)).toBe(true);
  for (const environment of ["preview", "production"] as const)
    expect(
      await f.accounting.recordAllocationAcknowledgment({
        month: a.month,
        version: 1,
        environment,
        manifestHash: HASH,
        drainReceiptId: crypto.randomUUID(),
        now: EXP,
      }),
    ).toBe(true);
  expect(await f.accounting.activateAllocation(a.month, 1, EXP)).toBe(true);
  expect(await f.runtime.initializeControl(a.month, EXP)).toBe(true);
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await f.runtime.putAllocationProof(ap, EXP)).toBe(true);
  const d = await f.runtime.drain(a.month, 1, ap.id, EXP);
  if (!d) throw Error("missing drain");
  expect(await f.runtime.putRemoteDrainProof(d, EXP)).toBe(true);
  const remote = {
    ...d,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  expect(await f.runtime.putRemoteDrainProof(remote, EXP)).toBe(true);
  await expect(f.runtime.activate(a.month, 2, ap.id, d.id, remote.id, EXP)).rejects.toThrow();
  expect(held(f).held_bytes).toBe(100);
});

test("paid composition cannot bind a foreign/mismatched pending tuple or silently change an existing capacity binding", async () => {
  const f = await ready(),
    i = await intent(f);
  const fake = { ...i, input: { ...i.input, objectKey: "private/wrong" } };
  await expect(admit(f, fake)).rejects.toThrow();
  expect(held(f).held_bytes).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 0 });
  expect(await admit(f, i)).toBe(true);
  const p = f.capacity.prepareCapacity(f.actor, { ...i.input, maximumCipherBytes: 99 }),
    claim = crypto.randomUUID();
  await expect(
    f.core.changed([
      f.core.claim(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
        claim,
        p.predicate.sql,
        [...p.predicate.values],
      ),
      ...p.statements(f.core, f.actor, claim),
      f.core.finish(claim),
    ]),
  ).rejects.toThrow();
  expect(held(f).held_bytes).toBe(100);
  expect(await f.capacity.beginWrite(i.id, 101, NOW)).toBeNull();
  expect(await f.capacity.beginWrite(i.id, 100, EXP)).toBeNull();
});
