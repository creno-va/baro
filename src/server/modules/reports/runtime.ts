import type { V2Core } from "../../db/v2-core";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import { readProcessingProofs } from "../../runtime/processing-proofs";
import { createProcessingBudgetService } from "../budget/processing-ledger";
import { createFilesService } from "../files/service";
import type { ReportDependencies } from "./storage";

/** Real Workers bindings only. Report drafts need no model/provider calls.
 * R2 writes require the existing monthly physical-retention projection and an
 * authenticated pricing/funding plan. No missing proof falls back to a mock.
 */
export function createReportDependencies(
  env: Env,
  core: V2Core,
  ownerId: string,
  clock = () => new Date().toISOString(),
): ReportDependencies {
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  return {
    environment,
    clock,
    bucket: env.CASE_PRIVATE_R2,
    files: createFilesService(core, { environment, bucket: env.CASE_PRIVATE_R2, clock }),
    font: async () => {
      const response = await env.ASSETS.fetch(
        new Request("https://baro.assets/fonts/BaroReport-Regular.ttf"),
      );
      if (!response.ok) throw new Error("REPORT_FONT_UNAVAILABLE");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 1000 || bytes.length > 4_000_000) throw new Error("REPORT_FONT_INVALID");
      return bytes;
    },
    costs: async (input) => {
      const budget = createProcessingBudgetService({
        core,
        environment,
        ownerId,
        clock,
        binding: async (now) => {
          const proofs = await readProcessingProofs(core, environment, now, "r2_class_a_requests");
          const operation = await core
            .statement(
              "SELECT o.revision,i.request_hash FROM v2_operations o JOIN v2_idempotency i ON i.operation_id=o.id WHERE o.id=? AND o.owner_id=?",
              [input.operationId, ownerId],
            )
            .first<{ revision: number; request_hash: string }>();
          return proofs && operation
            ? {
                ...proofs,
                operationId: input.operationId,
                operationRevision: operation.revision,
                requestHash: operation.request_hash,
                jobId: input.lease.jobId,
                targetKind: "report",
                targetId: input.reportId,
                targetRevision: input.sourceRevision,
                invocationId: `report-${input.blobId}-${input.lease.fencing}`,
                maximumAttempts: 1,
                deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
              }
            : null;
        },
        bounds: async (descriptor, inputDigest, now) => {
          if (descriptor.service !== "requests" || descriptor.action !== "r2_put") return null;
          const binding = await core
            .statement(
              `SELECT b.id,b.cipher_bytes FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_physical_blob_bindings p ON p.blob_id=b.id WHERE b.kind IN ('report_pdf','original_zip') AND b.visibility='private' AND b.state='pending' AND b.cipher_hash=? AND b.cipher_bytes=? AND r.entity_id=? AND r.operation_id=? AND p.environment=? AND p.owner_id=? AND p.state='held' AND p.writer_state='running' AND p.maximum_cipher_bytes>=b.cipher_bytes`,
              [
                descriptor.identity,
                descriptor.byteLength,
                input.reportId,
                input.operationId,
                environment,
                ownerId,
              ],
            )
            .first<{ id: string; cipher_bytes: number }>();
          if (!binding) return null;
          // Full approved physical capacity, ongoing storage and cleanup reserve
          // were funded before beginWrite. This plan bounds the single PUT.
          const capacity = createV2StorageCapacityRepository(core, environment);
          const prepared = capacity.prepareCapacity(
            { ownerId, now },
            {
              blobId: binding.id,
              ownerId,
              objectKey: `private/${binding.id}`,
              maximumCipherBytes: binding.cipher_bytes,
            },
          );
          if (
            !(await core
              .statement(`SELECT 1 AS ok WHERE ${prepared.predicate.sql}`, [
                ...prepared.predicate.values,
              ])
              .first())
          )
            return null;
          return {
            inputDigest,
            evidenceHash: await runtimeDigest({ kind: "report_r2_write", ...binding, inputDigest }),
            verifiedAt: now,
            validUntil: new Date(Date.parse(now) + 360000).toISOString(),
            quantities: [
              { sku: "r2_class_a_requests", maximumQuantity: "1" },
              { sku: "worker_requests", maximumQuantity: "1" },
              { sku: "worker_cpu_ms", maximumQuantity: "300000" },
              { sku: "d1_rows_read", maximumQuantity: String(input.workPlan.rowsRead) },
              { sku: "d1_rows_written", maximumQuantity: String(input.workPlan.rowsWritten) },
            ],
          };
        },
      });
      return budget.costs(input.lease);
    },
  };
}
