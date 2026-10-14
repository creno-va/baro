import { V2_LIMITS } from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import { createStorageBudgetService } from "../budget/storage-ledger";
import { fileStorageRequestCore } from "../files/limits";
import { LawyerError } from "./service";
export const LAWYER_STORAGE_WORK = Object.freeze({
  queries: 900,
  rowsRead: 1000000,
  rowsWritten: 5000,
  cpuMs: 300000,
});
const metered = new WeakSet<V2Core>();
export const hasLawyerStorageMeter = (core: V2Core) => metered.has(core);
export function lawyerStorageRequestCore(core: V2Core, requireRowMeta = true) {
  const bounded = fileStorageRequestCore(core, requireRowMeta, {
    work: LAWYER_STORAGE_WORK,
    cleanupQueries: 24,
    notificationQueries: 10,
    failure: () => new LawyerError("PROCESSING_UNAVAILABLE"),
  });
  metered.add(bounded);
  return bounded;
}
export const maximumAssetCipherBytes = (bytes: number) =>
  bytes + 4100 + Math.ceil(bytes / V2_LIMITS.chunkBytes) * 16;
/** Fixed server composition only. Source GET and destination PUT share one hold;
 * storage capacity and cleanup are separately prepaid by the current projection. */
export function createLawyerStorageBudget(
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
      const original = input.intent.kind === "lawyer_original";
      if (
        !hasLawyerStorageMeter(core) ||
        input.targetKind !== "profile_asset" ||
        input.service !== "requests" ||
        input.attemptOrdinal !== 1 ||
        input.maximumAttempts !== 1 ||
        input.pending.logicalBytes > V2_LIMITS.documentImageBytes ||
        input.pending.cipherBytes !== 0 ||
        input.pending.cipherHash !== null ||
        !(original
          ? input.action === "r2_put" && input.pending.keyVersion === "asset_binary_v1"
          : input.intent.kind === "approved_public_copy" &&
            input.action === "public_copy" &&
            input.pending.keyVersion === null)
      )
        return null;
      const bytes = original
        ? maximumAssetCipherBytes(input.pending.logicalBytes)
        : input.pending.logicalBytes;
      for (const at of [now, input.deadlineAt]) {
        const physical = capacity.prepareCapacity(
          { ownerId, now: at },
          {
            blobId: input.blobId,
            ownerId,
            objectKey: `${original ? "private" : "public"}/${input.blobId}`,
            maximumCipherBytes: bytes,
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
        ...(!original ? [{ sku: "r2_class_b_requests" as const, maximumQuantity: "1" }] : []),
        { sku: "worker_requests" as const, maximumQuantity: "1" },
        { sku: "worker_cpu_ms" as const, maximumQuantity: String(LAWYER_STORAGE_WORK.cpuMs) },
        {
          sku: "d1_rows_read" as const,
          maximumQuantity: String(LAWYER_STORAGE_WORK.rowsRead + 10000),
        },
        {
          sku: "d1_rows_written" as const,
          maximumQuantity: String(LAWYER_STORAGE_WORK.rowsWritten + 1000),
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
          policy: "lawyer-storage-bounded-single-put-v1",
        }),
      };
    },
  });
}
