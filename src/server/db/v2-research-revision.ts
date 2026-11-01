import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { storedMessageSchema, storedUserMessageSchema } from "../modules/workspace/stored-message";
import type { V2Core } from "./v2-core";
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
 * Only traverse server-authenticated comparison messages, never arbitrary chat jobs.
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
  for (const job of jobs) {
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
