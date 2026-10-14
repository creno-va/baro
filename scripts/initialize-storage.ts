import { z } from "zod";
import { usageDateKst } from "../src/server/db/repository";
import { createV2PaidRuntimeRepository, runtimeDigest } from "../src/server/db/v2-paid-runtime";
import {
  createV2StorageCapacityRepository,
  storageProjectionSchema,
} from "../src/server/db/v2-storage-capacity";
import { observationSchema, observeAiRuntime, operationsCore } from "./provision-ai-budget";

/** Trusted operator console observation only. Nonempty inventories require the
 * existing explicit bindInventory reconciliation; this tool never invents a
 * stopped writer or deletes an existing object to make bootstrap possible. */
export const emptyStorageInitializationSchema = storageProjectionSchema
  .pick({
    capacityBytes: true,
    getLimit: true,
    headLimit: true,
    deleteLimit: true,
    workerCpuMsPerIO: true,
    d1RowsReadPerIO: true,
    d1RowsWrittenPerIO: true,
  })
  .extend({
    expectedControlRevision: z.number().int().positive(),
    expectedReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
    inventory: z.strictObject({
      environment: z.enum(["preview", "production"]),
      checkedAt: z.iso.datetime(),
      privateBucketObjects: z.literal(0),
      publicBucketObjects: z.literal(0),
      authority: z.literal("authenticated_cloudflare_console"),
    }),
  })
  .strict();

// Legacy financial/IO fields may accompany an older operator request, but are
// deliberately not part of physical authorization or this operation's identity.
export const emptyPhysicalStorageInitializationSchema = emptyStorageInitializationSchema
  .pick({ capacityBytes: true, expectedReleaseSha: true, inventory: true })
  .strip();

/** Initialize only an empty physical ledger. Cost observations and financial
 * control phases are neither read nor changed; the authenticated inventory is
 * still required and is never represented as a provider/billing receipt. */
export async function initializeEmptyPhysicalStorage(
  binding: D1Database,
  environment: "preview" | "production",
  rawConfiguration: unknown,
  operationKey: string,
  servingSha: string,
  clock = () => new Date().toISOString(),
) {
  const configuration = emptyPhysicalStorageInitializationSchema.parse(rawConfiguration);
  const now = new Date(clock()).toISOString();
  if (
    configuration.inventory.environment !== environment ||
    configuration.expectedReleaseSha !== servingSha ||
    !/^[a-f0-9]{40}$/.test(servingSha) ||
    !operationKey ||
    operationKey.length > 128
  )
    throw new Error("STORAGE_INITIALIZATION_INPUT_INVALID");
  const core = operationsCore(binding);
  const digest = await runtimeDigest({
    kind: "empty_physical_storage",
    configuration,
    operationKey,
    environment,
  });
  const marker = `storage-physical-initialization:${environment}`;
  const receipt = JSON.stringify({
    version: 1,
    digest,
    capacityBytes: configuration.capacityBytes,
    inventoryHash: await runtimeDigest(configuration.inventory),
    inventoryCheckedAt: configuration.inventory.checkedAt,
    releaseSha: servingSha,
  });
  const readReceipt = () =>
    core.statement("SELECT value FROM app_metadata WHERE key=?", [marker]).first<string>("value");
  const matchesCapacity = () =>
    core
      .statement(
        "SELECT 1 FROM v2_physical_storage_capacity c JOIN v2_physical_storage_totals t ON t.environment=c.environment AND t.version=1 AND t.held_bytes=c.held_bytes JOIN v2_cost_execution_policy p ON p.environment=c.environment AND p.limits_enabled=0 WHERE c.environment=? AND c.capacity_bytes=? AND NOT EXISTS(SELECT 1 FROM v2_storage_integrity_faults WHERE environment=c.environment)",
        [environment, configuration.capacityBytes],
      )
      .first();
  const previous = await readReceipt();
  if (previous !== null && previous !== receipt)
    throw new Error("STORAGE_INITIALIZATION_IDENTITY_MISMATCH");
  const result = (replayed: boolean) => ({
    environment,
    initializationId: `physical-storage-${digest}`,
    capacityBytes: configuration.capacityBytes,
    replayed,
    nextAction: "none" as const,
  });
  // Exact committed retries remain valid after inventory ages or new objects
  // are admitted. They attest the original initialization, not a fresh scan.
  if (previous !== null) {
    if (!(await matchesCapacity())) throw new Error("STORAGE_INITIALIZATION_PHYSICAL_CONFLICT");
    return result(true);
  }
  if (
    Date.parse(configuration.inventory.checkedAt) > Date.parse(now) ||
    Date.parse(now) - Date.parse(configuration.inventory.checkedAt) > 300000
  )
    throw new Error("STORAGE_INITIALIZATION_INPUT_INVALID");
  const hasExecutionJournal = await core
    .statement("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v2_execution_admissions'")
    .first();
  // The journal is additive to older schemas. Live storage executions require
  // reconciliation under a physical lock; historical final records are kept.
  const empty = `NOT EXISTS(SELECT 1 FROM v2_blobs)
    AND NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings)
    AND NOT EXISTS(SELECT 1 FROM v2_storage_paid_executions)
    AND NOT EXISTS(SELECT 1 FROM v2_jobs WHERE status IN ('queued','running','validating'))
    ${hasExecutionJournal ? "AND NOT EXISTS(SELECT 1 FROM v2_execution_admissions WHERE environment=? AND kind='storage' AND state IN ('prepared','dispatched','unknown'))" : ""}
    AND NOT EXISTS(SELECT 1 FROM v2_physical_storage_capacity WHERE environment=?)
    AND NOT EXISTS(SELECT 1 FROM v2_storage_integrity_faults WHERE environment=?)
    AND EXISTS(SELECT 1 FROM v2_physical_storage_totals WHERE environment=? AND version=1 AND held_bytes=0)`;
  const claim = crypto.randomUUID();
  const claimed = "EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)";
  const batch = await binding.batch([
    core.statement(
      `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,?,0 WHERE ${empty} AND NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?)`,
      [
        claim,
        environment,
        digest,
        ...(hasExecutionJournal ? [environment] : []),
        environment,
        environment,
        environment,
        marker,
      ],
    ),
    core.statement(
      `INSERT INTO v2_cost_execution_policy(environment,limits_enabled) SELECT ?,0 WHERE ${claimed} ON CONFLICT(environment) DO UPDATE SET limits_enabled=0`,
      [environment, claim],
    ),
    core.statement(
      `INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) SELECT ?,? WHERE ${claimed}`,
      [environment, configuration.capacityBytes, claim],
    ),
    core.statement(`INSERT INTO app_metadata(key,value) SELECT ?,? WHERE ${claimed}`, [
      marker,
      receipt,
      claim,
    ]),
    core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [claim]),
  ]);
  if ((await readReceipt()) !== receipt || !(await matchesCapacity()))
    throw new Error("STORAGE_INITIALIZATION_PHYSICAL_CONFLICT");
  return result(batch[0]?.meta.changes !== 1);
}

export async function initializeEmptyStorage(
  binding: D1Database,
  environment: "preview" | "production",
  rawObservation: unknown,
  rawConfiguration: unknown,
  operationKey: string,
  servingSha: string,
  clock = () => new Date().toISOString(),
) {
  const configuration = emptyStorageInitializationSchema.parse(rawConfiguration);
  const observation = observationSchema.parse(rawObservation);
  const now = new Date(clock()).toISOString();
  if (
    configuration.inventory.environment !== environment ||
    configuration.expectedReleaseSha !== servingSha ||
    !/^[a-f0-9]{40}$/.test(servingSha) ||
    !operationKey ||
    operationKey.length > 128
  )
    throw new Error("STORAGE_INITIALIZATION_INPUT_INVALID");
  const digest = await runtimeDigest({ configuration, observation, operationKey, environment });
  const core = operationsCore(binding),
    month = usageDateKst(now).slice(0, 7);
  const marker = `storage-initialization:${environment}:${digest}`;
  const frozenReceipt = JSON.stringify({
    digest,
    month,
    revision: configuration.expectedControlRevision + 1,
  });
  const evidenceHash = await runtimeDigest(observation);
  const runtime = createV2PaidRuntimeRepository(core, environment);
  const allocationId = await core
    .statement(
      "SELECT allocation_proof_id FROM v2_runtime_controls WHERE month=? AND environment=?",
      [month, environment],
    )
    .first<string>("allocation_proof_id");
  const exposure = await runtime.exposure(now);
  if (!allocationId || !exposure) throw new Error("STORAGE_INITIALIZATION_ALLOCATION_REQUIRED");
  const { inventory, expectedControlRevision, expectedReleaseSha: _sha, ...limits } = configuration;
  const input = {
    ...limits,
    id: `storage-${digest}`,
    month,
    storageClass: "standard" as const,
    pricingProofId: `price-${environment}-${evidenceHash}`,
    fundingProofId: `fund-${environment}-${evidenceHash}`,
    allocationProofId: allocationId,
    expectedControlRevision: expectedControlRevision + 1,
    inventoryHash: await runtimeDigest(inventory),
  };
  const existing = await core
    .statement("SELECT payload_json FROM v2_storage_projections WHERE environment=? AND month=?", [
      environment,
      month,
    ])
    .first<string>("payload_json");
  if (existing) {
    const prior = JSON.parse(existing).input;
    // A later same-allocation refresh legitimately changes these three
    // authority fields. The original operation identity and physical limits
    // must still match, and its exact committed freeze receipt must exist.
    const initial = {
      ...prior,
      expectedControlRevision: input.expectedControlRevision,
      pricingProofId: input.pricingProofId,
      fundingProofId: input.fundingProofId,
    };
    const markerValue = await core
      .statement("SELECT value FROM app_metadata WHERE key=?", [marker])
      .first<string>("value");
    if (
      markerValue !== frozenReceipt ||
      (await runtimeDigest(initial)) !== (await runtimeDigest(input))
    )
      throw new Error("STORAGE_INITIALIZATION_EXISTING_PROJECTION");
    return {
      environment,
      projectionId: input.id,
      replayed: true,
      activatedByThisOperation: false,
      nextAction: "status-or-refresh",
    };
  }
  if (
    Date.parse(configuration.inventory.checkedAt) > Date.parse(now) ||
    Date.parse(now) - Date.parse(configuration.inventory.checkedAt) > 300000
  )
    throw new Error("STORAGE_INITIALIZATION_INPUT_INVALID");
  const empty =
    "NOT EXISTS(SELECT 1 FROM v2_blobs) AND NOT EXISTS(SELECT 1 FROM v2_physical_blob_bindings) AND NOT EXISTS(SELECT 1 FROM v2_storage_paid_executions) AND NOT EXISTS(SELECT 1 FROM v2_jobs WHERE status IN ('queued','running','validating')) AND NOT EXISTS(SELECT 1 FROM v2_storage_projections WHERE environment=? AND month=?)";
  if (!(await core.statement(`SELECT 1 WHERE ${empty}`, [environment, month]).first()))
    throw new Error("STORAGE_INITIALIZATION_INVENTORY_RECONCILIATION_REQUIRED");
  await observeAiRuntime({ [environment]: binding }, observation, "observe");
  const receipt = await core
    .statement("SELECT value FROM app_metadata WHERE key=?", [marker])
    .first<string>("value");
  if (receipt !== null && receipt !== frozenReceipt)
    throw new Error("STORAGE_INITIALIZATION_IDENTITY_MISMATCH");
  if (receipt === null) {
    // Freeze and its immutable request identity commit together. A lost reply
    // can only resume this exact operation, never another operator's freeze.
    const claim = crypto.randomUUID();
    await binding.batch([
      core.statement(
        `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,?,c.revision FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment WHERE c.environment=? AND c.month=? AND c.revision=? AND c.phase IN ('active','frozen') AND b.allocation_version=? AND ${empty} AND NOT EXISTS(SELECT 1 FROM app_metadata WHERE key=?)`,
        [
          claim,
          environment,
          input.id,
          environment,
          month,
          expectedControlRevision,
          exposure.allocation_version,
          environment,
          month,
          marker,
        ],
      ),
      core.statement(
        "INSERT INTO app_metadata(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)",
        [marker, frozenReceipt, claim],
      ),
      core.statement(
        "UPDATE v2_runtime_controls SET phase='frozen',pending_version=?,local_drain_id=NULL,revision=revision+1,updated_at=? WHERE environment=? AND month=? AND revision=? AND EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)",
        [exposure.allocation_version, now, environment, month, expectedControlRevision, claim],
      ),
      core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [claim]),
    ]);
  }
  if (
    !(await core
      .statement(
        "SELECT 1 FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month AND b.environment=c.environment WHERE c.environment=? AND c.month=? AND c.phase='frozen' AND c.revision=? AND c.pending_version=b.allocation_version AND EXISTS(SELECT 1 FROM app_metadata WHERE key=? AND value=?)",
        [environment, month, expectedControlRevision + 1, marker, frozenReceipt],
      )
      .first())
  )
    throw new Error("STORAGE_INITIALIZATION_FREEZE_CONFLICT");
  const verify = async (_kind: unknown, _payload: unknown, proofDigest: string) => ({
    digest: proofDigest,
    evidenceHash: digest,
    method: "authenticated_coordinator" as const,
    verifiedAt: now,
  });
  if (
    !(await createV2StorageCapacityRepository(core, environment, verify).reserveProjection(
      input,
      now,
    ))
  )
    throw new Error("STORAGE_INITIALIZATION_PROJECTION_REJECTED");
  return {
    environment,
    projectionId: input.id,
    replayed: receipt !== null,
    activatedByThisOperation: false,
    nextAction: "refresh",
  };
}
