import { aliveWorkspace, type V2Core } from "../../db/v2-core";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2StorageCapacityRepository } from "../../db/v2-storage-capacity";
import { storedWorkspaceContentSchema } from "../../db/v2-workspace";
import { readProcessingProofs } from "../../runtime/processing-proofs";
import { createProcessingBudgetService } from "../budget/processing-ledger";
import { boundedProcessingResources } from "../budget/processing-runtime";
import { namedProcessorPort } from "../file-processing/native-identity";
import { createProcessorTransport } from "../file-processing/transport";
import { createFilesService } from "../files/service";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { preparedAnalysisMatchesScope, readPreparedAnalysis } from "../rework/state";
import { REPORT_QUERY_LIMIT, REPORT_ROW_LIMIT } from "./limits";
import { ReportError } from "./source";
import type { ReportDependencies } from "./storage";

/** Real Workers bindings only. Report drafts need no model/provider calls.
 * Native HTML rendering and R2 writes retain technical admissions and private
 * storage fences. Missing cost observations do not block observation-only mode.
 */
export function createReportDependencies(
  env: Env,
  core: V2Core,
  ownerId: string,
  clock = () => new Date().toISOString(),
): ReportDependencies {
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const deps: ReportDependencies = {
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
          if (
            descriptor.service === "container" &&
            descriptor.action === "container_process" &&
            descriptor.byteLength <= 20_000_000
          )
            return boundedProcessingResources(descriptor, inputDigest, now);
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
  deps.renderPdf = async (html, input) => {
    if (!env.FILE_PROCESSOR || !deps.costs) throw new Error("REPORT_RENDERER_UNAVAILABLE");
    let runtimeId = await core
      .statement(
        "SELECT runtime_instance_id FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=? AND status='running'",
        [input.lease.jobId, input.lease.token, input.lease.fencing],
      )
      .first<string>("runtime_instance_id");
    if (runtimeId && /^report-local-[a-f0-9-]{36}-1$/.test(runtimeId)) {
      const upgraded = runtimeId.replace("report-local-", "native-v1-report-");
      const updated = await core
        .statement(
          "UPDATE v2_jobs SET runtime_instance_id=? WHERE id=? AND runtime_instance_id=? AND lease_token=? AND fencing=? AND status='running'",
          [upgraded, input.lease.jobId, runtimeId, input.lease.token, input.lease.fencing],
        )
        .run();
      if (updated.meta.changes !== 1) throw new Error("REPORT_RENDERER_UNAVAILABLE");
      runtimeId = upgraded;
    }
    if (!runtimeId || !/^native-v1-report-[a-f0-9-]{36}-1$/.test(runtimeId))
      throw new Error("REPORT_RENDERER_UNAVAILABLE");
    const costs = await deps.costs({
      ownerId,
      reportId: input.reportId,
      blobId: `renderer-${input.lease.fencing}`,
      operationId: input.operationId,
      sourceRevision: input.sourceRevision,
      lease: input.lease,
      workPlan: { queries: REPORT_QUERY_LIMIT, rowsRead: REPORT_ROW_LIMIT, rowsWritten: 1000 },
    });
    const processor = createProcessorTransport({
      ...namedProcessorPort(env.FILE_PROCESSOR, runtimeId),
      costs,
    });
    const signal = AbortSignal.timeout(265_000);
    return processor.renderReport(html, {
      signal,
      authorize: async () => {
        await input.authorize();
        return true;
      },
    });
  };
  return deps;
}

/** Installed clients keep their legacy report source until this case explicitly
 * opts into a confirmed purpose. No stored legacy body is silently rewritten. */
export async function createCaseReportDependencies(
  env: Env,
  core: V2Core,
  ownerId: string,
  caseId?: string,
  reportId?: string,
  clock = () => new Date().toISOString(),
): Promise<ReportDependencies> {
  const deps = createReportDependencies(env, core, ownerId, clock);
  const id =
    caseId ??
    (reportId
      ? await core
          .statement(
            "SELECT r.workspace_id FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE r.id=? AND w.owner_id=?",
            [reportId, ownerId],
          )
          .first<string>("workspace_id")
      : null);
  if (!id) return deps;
  // Keep report request meter errors intact; repository safe() wrappers would
  // otherwise replace a missing native D1 receipt with DB_OPERATION_FAILED.
  const row = await core
    .statement(
      `SELECT w.revision,w.encrypted_payload FROM v2_workspaces w JOIN user u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
      [id, ownerId],
    )
    .first<{ revision: number; encrypted_payload: string }>();
  if (!row) return deps;
  const content = await core.decrypt(
    "v2_workspaces",
    id,
    ownerId,
    1,
    row.encrypted_payload,
    storedWorkspaceContentSchema,
  );
  if (
    !(await core
      .statement(
        `SELECT w.id FROM v2_workspaces w JOIN user u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND w.encrypted_payload=? AND ${aliveWorkspace}`,
        [id, ownerId, row.revision, row.encrypted_payload],
      )
      .first())
  )
    throw new ReportError("STALE_REVISION");
  if (!content.reworkContext || content.reworkContext.casePurpose === "unconfirmed") return deps;
  return {
    ...deps,
    guideHosts: GUIDE_HOSTS,
    readPreparedAnalysis: (actor, id) => readPreparedAnalysis(core, actor, id),
    preparedAnalysisMatchesScope: (actor, id, snapshot, scope) =>
      preparedAnalysisMatchesScope(core, actor, id, snapshot, {
        ...scope,
        excludedFileIds: [...scope.excludedFileIds],
      }),
  };
}
