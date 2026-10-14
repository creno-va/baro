import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2StorageCapacityRepository } from "../src/server/db/v2-storage-capacity";
import {
  type CleanupFailureEvent,
  createV2DeletionReconciler,
} from "../src/server/modules/deletion/v2-reconcile";
import { digest } from "../src/server/modules/files/binary";
import { createTestDatabase } from "./helpers/d1";
import { r2 } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const missing = {
  get: async () => {
    throw new Error("instance.not_found");
  },
};
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db);
  const actor = { ownerId: owner.userId, now: new Date().toISOString() };
  const core = createV2Core(
    db.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") }),
    { applicationCostLimitsEnabled: false },
  );
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const journalId = crypto.randomUUID();
  db.sqlite
    .query(
      "INSERT INTO v2_deletion_journals(id,target_kind,target_id,created_at,next_attempt_at) VALUES(?,'blob',?,?,?)",
    )
    .run(journalId, crypto.randomUUID(), actor.now, actor.now);
  return { db, actor, core, journalId };
}

const workflowScopes = ["file", "asset", "workspace", "profile"] as const;
for (const { fault, index } of [
  { fault: "native_revoke" as const, index: 0 },
  ...workflowScopes.flatMap((_, index) => [
    { fault: "workflow_get" as const, index },
    { fault: "workflow_delete" as const, index },
  ]),
])
  test(`cleanup identifies ${fault} in namespace ${workflowScopes[index]} without disclosing error data`, async () => {
    const f = await fixture(),
      id = `native-v1-asset-${crypto.randomUUID()}-1`;
    f.db.sqlite
      .query(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,0)",
      )
      .run(f.journalId, id);
    const events: CleanupFailureEvent[] = [];
    const workflow = {
      get: async () => {
        if (fault === "workflow_get") throw new Error("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
        return {
          delete: async () => {
            if (fault === "workflow_delete") throw new Error("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
          },
        };
      },
    };
    const result = await createV2DeletionReconciler(f.core, {
      environment: "preview",
      clock: () => f.actor.now,
      workflows: workflowScopes.map((_, current) => (current === index ? workflow : missing)),
      stopNative: async () => {
        if (fault === "native_revoke") throw new Error("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
      },
      onFailure: (event) => events.push(event),
    }).run();
    expect(result).toEqual({ acquired: 1, completed: 0, retry: 1 });
    expect(events).toEqual([
      {
        event: "v2_deletion_cleanup_failed",
        environment: "preview",
        reason: "CLEANUP_DEPENDENCY_UNAVAILABLE",
        stage: fault,
        namespace: fault === "native_revoke" ? "unknown" : (workflowScopes[index] ?? "unknown"),
        attempts: 1,
        ageSeconds: 0,
      },
    ]);
    expect(
      f.db.sqlite
        .query("SELECT state FROM v2_deletion_targets WHERE journal_id=?")
        .all(f.journalId),
    ).toEqual([{ state: "pending" }]);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
  });

for (const fault of ["none", "r2_delete", "r2_head", "object_remains"] as const)
  test(`observation-only cleanup without financial proofs retains exact physical state for ${fault}`, async () => {
    const f = await fixture(),
      id = crypto.randomUUID(),
      reservation = crypto.randomUUID();
    const bytes = new Uint8Array(100),
      hash = await digest(bytes),
      key = `private/${id}`;
    const cipher = await f.core.encrypt("v2_blobs", id, f.actor.ownerId, 1, { contentHash: hash });
    f.db.sqlite
      .query(
        "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
      )
      .run();
    f.db.sqlite
      .query(
        "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,created_at) SELECT ?,id,?,?,?,'derived_report',100,? FROM v2_billing_principals WHERE owner_id=?",
      )
      .run(reservation, crypto.randomUUID(), id, id, f.actor.now, f.actor.ownerId);
    f.db.sqlite
      .query(
        "UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes+100 WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)",
      )
      .run(f.actor.ownerId);
    const capacity = createV2StorageCapacityRepository(f.core, "preview");
    const physical = capacity.prepareCapacity(f.actor, {
      blobId: id,
      ownerId: f.actor.ownerId,
      objectKey: key,
      maximumCipherBytes: 100,
    });
    const claim = crypto.randomUUID();
    expect(
      await f.core.changed([
        f.core.statement(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,1 WHERE ${physical.predicate.sql}`,
          [claim, f.actor.ownerId, id, ...physical.predicate.values],
        ),
        f.core.statement(
          "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,id,?,'derivative','private','pending',?,100,100,?,'artifact_v1',?,? FROM v2_billing_principals WHERE owner_id=? AND EXISTS(SELECT 1 FROM v2_mutation_claims WHERE id=?)",
          [id, reservation, key, hash, cipher, f.actor.now, f.actor.ownerId, claim],
        ),
        ...physical.statements(f.core, f.actor, claim),
        f.core.finish(claim),
      ]),
    ).toBe(true);
    f.db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(id);
    f.db.sqlite
      .query(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'blob',?,0)",
      )
      .run(f.journalId, id);
    const bucket = r2();
    bucket.objects.set(key, bytes);
    const events: CleanupFailureEvent[] = [];
    const result = await createV2DeletionReconciler(f.core, {
      environment: "preview",
      clock: () => f.actor.now,
      workflows: [missing, missing, missing, missing],
      privateBucket: {
        ...bucket.port,
        delete: async (key) => {
          if (fault === "r2_delete") throw new Error("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
          if (fault !== "object_remains") await bucket.port.delete(key);
        },
        head: async (key) => {
          if (fault === "r2_head") throw new Error("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
          return bucket.port.head(key);
        },
      },
      onFailure: (event) => events.push(event),
    }).run();
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_storage_projections").get()).toEqual({
      n: 0,
    });
    if (fault === "none") {
      expect(result).toEqual({ acquired: 1, completed: 1, retry: 0 });
      expect(bucket.objects.size).toBe(0);
      expect(events).toEqual([]);
      expect(
        f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get(),
      ).toEqual({ held_bytes: 0 });
    } else {
      expect(result).toEqual({ acquired: 1, completed: 0, retry: 1 });
      expect(events[0]?.reason).toBe(
        fault === "object_remains" ? "CLEANUP_OBJECT_REMAINS" : "CLEANUP_DEPENDENCY_UNAVAILABLE",
      );
      expect(events[0]?.stage).toBe(fault === "object_remains" ? "unknown" : fault);
      expect(events[0]?.namespace).toBe("unknown");
      expect(JSON.stringify(events)).not.toContain("SYNTHETIC_PRIVATE_DEPENDENCY_ERROR");
      expect(JSON.stringify(events)).not.toContain(key);
      expect(JSON.stringify(events)).not.toContain(f.actor.ownerId);
      expect(
        f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get(),
      ).toEqual({ held_bytes: 100 });
      expect(
        f.db.sqlite
          .query("SELECT state FROM v2_deletion_targets WHERE journal_id=?")
          .all(f.journalId),
      ).toEqual([{ state: "pending" }]);
    }
  });

for (const fault of ["inventory_sql", "legacy_unproven"] as const)
  test(`cleanup uses the actual SQL failure stage or unknown fallback after exact missing instances: ${fault}`, async () => {
    const f = await fixture(),
      id = crypto.randomUUID();
    f.db.sqlite
      .query(
        "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) VALUES(?,'job',?,0)",
      )
      .run(f.journalId, id);
    const original = f.core.statement;
    f.core.statement = (sql, values) => {
      if (fault === "inventory_sql" && sql.startsWith("SELECT t.ordinal,t.kind,t.target_id"))
        throw new Error("SYNTHETIC_SQL_PRIVATE_DETAIL");
      return original(sql, values);
    };
    const events: CleanupFailureEvent[] = [];
    expect(
      await createV2DeletionReconciler(f.core, {
        environment: "preview",
        clock: () => f.actor.now,
        workflows: [missing, missing, missing, missing],
        onFailure: (event) => {
          events.push(event);
          throw new Error("SYNTHETIC_OBSERVER_ERROR");
        },
      }).run(),
    ).toEqual({ acquired: 1, completed: 0, retry: 1 });
    expect(events).toEqual([
      {
        event: "v2_deletion_cleanup_failed",
        environment: "preview",
        reason:
          fault === "inventory_sql"
            ? "CLEANUP_DEPENDENCY_UNAVAILABLE"
            : "CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED",
        stage: fault === "inventory_sql" ? "inventory_sql" : "unknown",
        namespace: "unknown",
        attempts: 1,
        ageSeconds: 0,
      },
    ]);
    expect(
      f.db.sqlite
        .query("SELECT state FROM v2_deletion_targets WHERE journal_id=?")
        .all(f.journalId),
    ).toEqual([{ state: "pending" }]);
    expect(
      f.db.sqlite.query("SELECT state FROM v2_deletion_journals WHERE id=?").get(f.journalId),
    ).toEqual({ state: "failed" });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cleanup_receipts").get()).toEqual({ n: 0 });
  });
