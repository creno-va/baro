import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { storedMessageSchema, storedUserMessageSchema } from "../modules/workspace/stored-message";
import type { V2Core } from "./v2-core";
import { readReportRevision, reportRevisionId } from "./v2-report-revision";
import { createV2ReworkRepository } from "./v2-rework";

const analysisTaskIdentity = z.object({
  kind: z.enum(["legal_analysis", "summary_reconciliation"]),
  jobId: opaqueIdSchema,
  operationId: opaqueIdSchema,
  beforeWorkspaceRevision: revisionSchema,
  targetWorkspaceRevision: revisionSchema,
  summaryRevision: revisionSchema,
});

/** Job admission/publication advance the CAS revision without changing case facts.
 * Only traverse server-authenticated comparison or unchanged publication proofs.
 * A gap, another mutation or an incomplete history remains a real revision boundary.
 */
export async function researchRevisionBase(
  core: V2Core,
  ownerId: string,
  workspaceId: string,
  revision: number,
  summaryRevision: number,
) {
  const jobs = (
    await core
      .statement(
        `SELECT j.id,j.operation_id,j.target_revision,j.status,w.current_job_id FROM v2_jobs j
     JOIN v2_workspaces w ON w.id=j.workspace_id JOIN v2_operations o ON o.id=j.operation_id
     WHERE w.id=? AND w.owner_id=? AND o.owner_id=w.owner_id AND j.target_kind='workspace'
     AND j.kind='chat_response' AND j.target_revision<=? ORDER BY j.target_revision DESC LIMIT 32`,
        [workspaceId, ownerId, revision],
      )
      .all<{
        id: string;
        operation_id: string;
        target_revision: number;
        status: string;
        current_job_id: string | null;
      }>()
  ).results;
  let base = revision;
  for (let steps = 0; steps < 64 && base > 1; steps++) {
    // Report drafting/export creates a CAS version without changing source
    // facts. Require its real operation, report job and published body before
    // traversing that one revision. Report scope remains in the analysis hash.
    const report = await core
      .statement(
        `SELECT r.id,'draft' AS kind FROM v2_reports r
      JOIN v2_operations o ON o.id=r.operation_id JOIN v2_jobs j ON j.operation_id=o.id
      JOIN v2_private_snapshots s ON s.id=r.snapshot_id
      WHERE r.workspace_id=? AND r.workspace_revision=? AND r.summary_revision=?
      AND o.owner_id=? AND o.workspace_id=r.workspace_id AND o.kind='report' AND o.revision=r.workspace_revision
      AND j.target_kind='report' AND j.target_id=r.id AND j.target_revision=r.workspace_revision AND j.kind='report_build'
      AND s.owner_id=o.owner_id AND s.workspace_id=r.workspace_id AND s.target_id=r.id AND s.purpose='report' AND s.revision=r.workspace_revision AND s.state='published'
      UNION ALL SELECT id,'export' AS kind FROM v2_rework_records WHERE owner_id=? AND workspace_id=? AND kind='checkpoint'
      AND id=? AND workspace_revision=? AND revision=? AND state='published' LIMIT 1`,
        [
          workspaceId,
          base - 1,
          summaryRevision,
          ownerId,
          ownerId,
          workspaceId,
          await reportRevisionId(workspaceId, base),
          base,
          base,
        ],
      )
      .first<{ id: string; kind: string }>();
    if (report) {
      if (report.kind === "draft") {
        base--;
        continue;
      }
      const before = await readReportRevision(
        core,
        ownerId,
        workspaceId,
        base,
        summaryRevision,
        report.id,
      );
      if (before !== null) {
        base = before;
        continue;
      }
      break;
    }
    const job = jobs.find(
      (job) => job.target_revision === base || job.target_revision === base - 1,
    );
    if (!job) break;
    const admitted =
      job.target_revision === base &&
      job.current_job_id === job.id &&
      ["queued", "running", "validating"].includes(job.status);
    const published = job.target_revision === base - 1 && job.status === "completed";
    const failed = job.target_revision === base - 1 && job.status === "failed";
    if (!admitted && !published && !failed) break;
    const taskRow = await core
      .statement(
        "SELECT id FROM v2_rework_records WHERE workspace_id=? AND kind='task' AND entity_id=? AND state='published'",
        [workspaceId, job.id],
      )
      .first();
    if (taskRow) {
      const task = await createV2ReworkRepository(core).read(
        { ownerId, now: new Date().toISOString() },
        workspaceId,
        "task",
        job.id,
        analysisTaskIdentity,
      );
      if (
        task?.value.kind !== "legal_analysis" ||
        task.value.jobId !== job.id ||
        task.value.operationId !== job.operation_id ||
        task.value.summaryRevision !== summaryRevision ||
        task.value.targetWorkspaceRevision !== job.target_revision ||
        task.value.beforeWorkspaceRevision !== job.target_revision - 1 ||
        task.workspaceRevision !== job.target_revision
      )
        break;
      base = task.value.beforeWorkspaceRevision;
      continue;
    }
    const rows = (
      await core
        .statement(
          "SELECT id,revision,role,encrypted_payload FROM v2_messages WHERE workspace_id=? AND operation_id=? ORDER BY role",
          [workspaceId, job.operation_id],
        )
        .all<{ id: string; revision: number; role: string; encrypted_payload: string }>()
    ).results;
    const userRow = rows.find((row) => row.role === "user");
    if (!userRow) break;
    const user = await core.decrypt(
      "v2_messages",
      userRow.id,
      ownerId,
      userRow.revision,
      userRow.encrypted_payload,
      storedUserMessageSchema,
    );
    const request = user.precedentComparisonRequest;
    if (!request && published && !user.selectedFileIds.length && !user.lookupRequests?.length) {
      const row = rows.find((row) => row.role === "assistant");
      if (!row) break;
      const message = await core.decrypt(
        "v2_messages",
        row.id,
        ownerId,
        row.revision,
        row.encrypted_payload,
        storedMessageSchema(),
      );
      const proof = message.role === "assistant" ? message.unchangedResearch : null;
      if (
        message.role === "assistant" &&
        proof &&
        proof.beforeWorkspaceRevision === job.target_revision - 1 &&
        proof.summaryRevision === summaryRevision &&
        user.operationId === job.operation_id &&
        user.workspaceRevision === job.target_revision &&
        message.operationId === job.operation_id &&
        message.workspaceRevision === job.target_revision &&
        !message.citations.length &&
        !message.references.some((reference) => reference.kind === "official_source") &&
        !message.precedentComparison &&
        !message.toolResults?.length
      ) {
        base = proof.beforeWorkspaceRevision;
        continue;
      }
    }
    if (
      !request ||
      request.expectedRevision !== job.target_revision - 1 ||
      request.summaryRevision !== summaryRevision ||
      user.operationId !== job.operation_id ||
      user.workspaceRevision !== job.target_revision ||
      user.selectedFileIds.length
    )
      break;
    if (failed && rows.some((row) => row.role === "assistant")) break;
    if (published) {
      const row = rows.find((row) => row.role === "assistant");
      if (!row) break;
      const message = await core.decrypt(
        "v2_messages",
        row.id,
        ownerId,
        row.revision,
        row.encrypted_payload,
        storedMessageSchema(),
      );
      const comparison = message.role === "assistant" ? message.precedentComparison : null;
      if (
        !comparison ||
        comparison.basedOnWorkspaceRevision !== request.expectedRevision ||
        comparison.publishedWorkspaceRevision !== base ||
        comparison.summaryRevision !== summaryRevision
      )
        break;
    }
    base = request.expectedRevision;
  }
  return base;
}
