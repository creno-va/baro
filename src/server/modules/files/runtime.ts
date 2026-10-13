import { V2_LIMITS } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import { createStorageBudgetService } from "../budget/storage-ledger";
import { FILE_STORAGE_WORK, hasFileStorageMeter } from "./limits";

/** One encrypted original chunk produces one PUT. Ongoing bytes and cleanup
 * must already have a funded physical projection; this never creates proofs. */
export function createFileStorageBudget(
  core: V2Core,
  environment: "preview" | "production",
  ownerId: string,
  clock = () => new Date().toISOString(),
) {
  const capacity = createV2StorageCapacityRepository(core, environment);
  return createStorageBudgetService({
    core,
    environment,
    ownerId,
    clock,
    bounds: async (input, inputDigest, now) => {
      if (
        !hasFileStorageMeter(core) ||
        input.service !== "requests" ||
        input.action !== "r2_put" ||
        input.targetKind !== "file" ||
        input.intent.kind !== "case_original" ||
        input.attemptOrdinal !== 1 ||
        input.maximumAttempts !== 1 ||
        input.pending.keyVersion !== "binary_v1" ||
        input.pending.cipherHash === null ||
        input.pending.logicalBytes > V2_LIMITS.chunkBytes ||
        input.pending.cipherBytes <= input.pending.logicalBytes + 20 ||
        input.pending.cipherBytes > input.pending.logicalBytes + 4116
      )
        return null;
      // Check both the current projection and its validity through dispatch.
      // The same capacity condition is rechecked atomically with the pending
      // blob and paid hold; a concurrent freeze or exhausted capacity loses CAS.
      for (const at of [now, input.deadlineAt]) {
        const physical = capacity.prepareCapacity(
          { ownerId, now: at },
          {
            blobId: input.blobId,
            ownerId,
            objectKey: `private/${input.blobId}`,
            maximumCipherBytes: input.pending.cipherBytes,
          },
        );
        if (
          !(await core
            .statement(`SELECT 1 WHERE ${physical.predicate.sql}`, [...physical.predicate.values])
            .first())
        )
          return null;
      }
      const quantities = [
        { sku: "r2_class_a_requests" as const, maximumQuantity: "1" },
        { sku: "worker_requests" as const, maximumQuantity: "1" },
        // Workers' maximum configurable HTTP CPU time is five minutes.
        // https://developers.cloudflare.com/workers/platform/limits/#cpu-time
        { sku: "worker_cpu_ms" as const, maximumQuantity: String(FILE_STORAGE_WORK.cpuMs) },
        {
          sku: "d1_rows_read" as const,
          maximumQuantity: String(FILE_STORAGE_WORK.rowsRead + 1000),
        },
        {
          sku: "d1_rows_written" as const,
          maximumQuantity: String(FILE_STORAGE_WORK.rowsWritten + 100),
        },
      ];
      return {
        inputDigest,
        quantities,
        verifiedAt: now,
        validUntil: input.deadlineAt,
        evidenceHash: await runtimeDigest({
          inputDigest,
          quantities,
          policy: "case-original-single-put-v1",
        }),
      };
    },
  });
}
