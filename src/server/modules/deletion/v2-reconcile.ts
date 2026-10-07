import { createCaseDataCipher } from "../../crypto";
import { createV2Core, type V2Core } from "../../db/v2-core";
import { createV2DeletionRepository } from "../../db/v2-deletion";
import { createV2StorageRepository } from "../../db/v2-storage";
import { authorizeBlobCleanup, createStorageMaintenance } from "../budget/storage-maintenance";
import type { PrivateBucket } from "../files/service";

export type CleanupWorkflow = { get(id: string): Promise<{ delete(): Promise<void> }> };
export type DeletionCleanupDependencies = {
  environment: "preview" | "production";
  privateBucket?: PrivateBucket;
  publicBucket?: PrivateBucket;
  /** All namespaces are required because the durable inventory retains runtime IDs after cascade deletion. */
  workflows: readonly (CleanupWorkflow | undefined)[];
  legacyWorkflow?: CleanupWorkflow;
  stopProbe?: (runtimeId: string) => Promise<void>;
  /** Coordinator receipt for legacy/unknown runtime IDs. Absence from Workflow
   * namespaces alone cannot prove that an older Container probe has stopped. */
  confirmAbsentJob?: (runtimeId: string) => Promise<boolean>;
  clock?: () => string;
  testOnlyUnmeteredStorage?: true;
};
/** A real platform response or the exact missing-instance sentinel is a receipt.
 * Network, authorization and arbitrary errors retain the target for retry. */
async function stop(binding: CleanupWorkflow | undefined, id: string) {
  if (!binding) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
  try {
    await (await binding.get(id)).delete();
    return true;
  } catch (error) {
    if (!(error instanceof Error && error.message === "instance.not_found")) throw error;
    return false;
  }
}
export function createV2DeletionReconciler(core: V2Core, deps: DeletionCleanupDependencies) {
  const now = deps.clock ?? (() => new Date().toISOString());
  const deletion = createV2DeletionRepository(core),
    storage = createV2StorageRepository(core);
  const maintenance = createStorageMaintenance(core, deps.environment, now);
  const test = deps.environment === "preview" && deps.testOnlyUnmeteredStorage === true;
  if (deps.testOnlyUnmeteredStorage && !test) throw new Error("CLEANUP_TEST_COMPOSITION_INVALID");
  return {
    async run(limit = 4) {
      const result = { acquired: 0, completed: 0, retry: 0 };
      for (const journal of await deletion.pending(now(), limit)) {
        const started = now();
        const lease = await deletion.acquire(
          journal.id,
          crypto.randomUUID(),
          started,
          new Date(Date.parse(started) + 60000).toISOString(),
        );
        if (!lease) continue;
        result.acquired++;
        try {
          // Work per invocation is bounded. Receipts and remaining targets survive
          // lease expiry, partial transport failures and another scheduler's replay.
          for (const target of await deletion.targets(lease, now(), 8)) {
            if (target.kind === "job" || target.kind === "legacy_workflow") {
              if (target.kind === "legacy_workflow")
                await stop(deps.legacyWorkflow, target.target_id);
              else if (/^probe-[a-f0-9-]{36}-1$/.test(target.target_id)) {
                if (!deps.stopProbe) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
                await deps.stopProbe(target.target_id);
              } else if (!/^report-local-[a-f0-9-]{36}-1$/.test(target.target_id)) {
                if (deps.workflows.length !== 4) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
                let observed = false;
                for (const binding of deps.workflows)
                  observed = (await stop(binding, target.target_id)) || observed;
                if (
                  !observed &&
                  !/^file-processing-[a-f0-9-]{36}-[1-9][0-9]*$/.test(target.target_id) &&
                  !(await deps.confirmAbsentJob?.(target.target_id))
                )
                  throw new Error("CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED");
              }
              // Local report jobs never invoke a Workflow. Their running R2 writer
              // is independently fenced below; a cancelled lease cannot send new I/O.
              if (
                !(await deletion.recordReceipt(lease, {
                  kind: target.kind,
                  targetId: target.target_id,
                  receiptId: crypto.randomUUID(),
                  now: now(),
                }))
              )
                throw new Error("CLEANUP_FENCED");
            } else if (target.kind === "blob") {
              const blob = await core
                .statement(
                  "SELECT visibility,object_key,cipher_hash,state FROM v2_blobs WHERE id=?",
                  [target.target_id],
                )
                .first<{
                  visibility: string;
                  object_key: string;
                  cipher_hash: string | null;
                  state: string;
                }>();
              if (!blob || blob.object_key !== target.object_key)
                throw new Error("CLEANUP_INVENTORY_INVALID");
              if (blob.state === "deleted") {
                if (
                  !(await deletion.recordReceipt(lease, {
                    kind: "blob",
                    targetId: target.target_id,
                    receiptId: crypto.randomUUID(),
                    now: now(),
                  }))
                )
                  throw new Error("CLEANUP_FENCED");
                continue;
              }
              const prefix = blob.visibility === "public" ? "public" : "private";
              const bucket = blob.visibility === "public" ? deps.publicBucket : deps.privateBucket;
              if (!bucket || !new RegExp(`^${prefix}/[A-Za-z0-9_-]{1,128}$`).test(blob.object_key))
                throw new Error("CLEANUP_BUCKET_UNAVAILABLE");
              const authorize = async () =>
                (await authorizeBlobCleanup(
                  core,
                  lease,
                  target.target_id,
                  blob.object_key,
                  now(),
                )) &&
                !(await core
                  .statement(
                    "SELECT 1 FROM v2_deletion_targets b JOIN v2_deletion_targets jobs ON jobs.journal_id=b.journal_id WHERE b.kind='blob' AND b.target_id=? AND jobs.kind IN ('job','legacy_workflow') AND jobs.state='pending' LIMIT 1",
                    [target.target_id],
                  )
                  .first());
              if (
                !(await authorize()) ||
                (!test &&
                  !(await maintenance.admit(
                    target.target_id,
                    blob.object_key,
                    "delete",
                    authorize,
                  )))
              )
                throw new Error("CLEANUP_WRITER_OR_BUDGET_PENDING");
              await bucket.delete(blob.object_key);
              if (
                !(await authorize()) ||
                (!test &&
                  !(await maintenance.admit(target.target_id, blob.object_key, "head", authorize)))
              )
                throw new Error("CLEANUP_FENCED");
              if (await bucket.head(blob.object_key)) throw new Error("CLEANUP_OBJECT_REMAINS");
              if (
                !(await storage.confirmBlobDeleted(target.target_id, now(), {
                  lease,
                  receiptId: crypto.randomUUID(),
                  objectKey: blob.object_key,
                  cipherHash: blob.cipher_hash,
                }))
              )
                throw new Error("CLEANUP_FENCED");
            } else {
              // SQL checks the complete retained blob inventory, including late
              // arrivals, and that every job/blob target has an earlier receipt.
              if (
                !(await storage.confirmEmptyReservation(lease, {
                  receiptId: crypto.randomUUID(),
                  reservationId: target.target_id,
                  now: now(),
                  inventoryVerified: true,
                }))
              )
                throw new Error("CLEANUP_INVENTORY_PENDING");
            }
          }
          if (await deletion.finish(lease, now())) {
            result.completed++;
            continue;
          }
        } catch {
          /* Preserve inventory and physical exposure; never manufacture a receipt. */
        }
        result.retry++;
        const failedAt = now();
        await deletion.fail(lease, failedAt, new Date(Date.parse(failedAt) + 60000).toISOString());
      }
      return result;
    },
  };
}
/** Session 4 mounts this in scheduled(), after auth/file intent reconciliation. */
export async function reconcileV2Deletion(env: Env) {
  const core = createV2Core(env.DB, await createCaseDataCipher(env), {
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  return createV2DeletionReconciler(core, {
    environment: env.APP_ENV === "production" ? "production" : "preview",
    privateBucket: env.CASE_PRIVATE_R2,
    publicBucket: env.PROFILE_PUBLIC_R2,
    workflows: [
      env.FILE_PROCESSING,
      env.ASSET_PROCESSING,
      env.WORKSPACE_PROCESSING,
      env.PROFILE_PUBLICATION,
    ],
    legacyWorkflow: env.ANALYSIS_WORKFLOW,
    stopProbe: async (id) => {
      if (!env.FILE_PROCESSOR) throw new Error("CLEANUP_BINDING_UNAVAILABLE");
      await env.FILE_PROCESSOR.get(env.FILE_PROCESSOR.idFromName(id)).stop("SIGKILL");
    },
  }).run();
}
