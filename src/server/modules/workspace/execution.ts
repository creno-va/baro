import { z } from "zod";
import { opaqueIdSchema } from "../../../contracts";
import { type V2Job, v2SummarySchema } from "../../../contracts/v2";
import { fragmentText, utf8Bytes, type V2Core } from "../../db/v2-core";
import { createV2JobsRepository } from "../../db/v2-jobs";
import { createV2StagingRepository } from "../../db/v2-staging";
import { createV2SummaryStagingRepository } from "../../db/v2-summary-staging";
import { createV2WorkspaceRepository, type JobLease } from "../../db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../../db/v2-workspace-response";
import { ModelError } from "../llm-gateway/service";
import { readWorkspaceContext } from "./context";
import type { createWorkspacePipeline, WorkspaceContext } from "./pipeline";

export const workspaceParamsSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  workspaceRevision: z.number().int().positive(),
  jobId: opaqueIdSchema,
});
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;
export async function executeWorkspace(
  core: V2Core,
  raw: WorkspaceParams,
  instanceId: string,
  options: {
    clock?: () => string;
    guideHosts?: readonly string[];
    authorize: (ownerId: string) => Promise<boolean>;
    pipeline: (
      job: V2Job,
      lease: JobLease,
      context: WorkspaceContext,
    ) => Promise<ReturnType<typeof createWorkspacePipeline>>;
  },
) {
  const params = workspaceParamsSchema.parse(raw),
    clock = options.clock ?? (() => new Date().toISOString()),
    actor = () => ({ ownerId: params.ownerId, now: clock() });
  const jobs = createV2JobsRepository(core),
    workspace = createV2WorkspaceRepository(core.binding, core.cipher, options.guideHosts);
  const current = await jobs.find(actor(), params.jobId);
  if (current?.status === "completed") return { jobId: params.jobId, status: "completed" as const };
  if (
    !current ||
    current.target.kind !== "workspace" ||
    current.target.caseId !== params.workspaceId ||
    current.target.workspaceRevision !== params.workspaceRevision ||
    !(await options.authorize(params.ownerId))
  )
    return { jobId: params.jobId, status: "stopped" as const };
  const runtime = await core
    .statement("SELECT runtime_instance_id FROM v2_jobs WHERE id=?", [params.jobId])
    .first<{ runtime_instance_id: string }>();
  if (runtime?.runtime_instance_id !== instanceId)
    return { jobId: params.jobId, status: "stopped" as const };
  const paid = await core
    .statement(
      "SELECT h.attempt_id FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id WHERE h.job_id=? AND h.state='prepared' AND p.target_revision=? AND p.deadline_at>? ORDER BY h.attempt_id LIMIT 1",
      [params.jobId, params.workspaceRevision, clock()],
    )
    .first<{ attempt_id: string }>();
  const acquired = await jobs.acquire(
    actor(),
    params.jobId,
    crypto.randomUUID(),
    new Date(Date.parse(clock()) + 300000).toISOString(),
    paid?.attempt_id ?? null,
  );
  if (!acquired) return { jobId: params.jobId, status: "stopped" as const };
  const lease = acquired.lease,
    guard = () => ({
      ...actor(),
      workspaceId: params.workspaceId,
      expectedRevision: params.workspaceRevision,
    });
  try {
    const latest =
      acquired.job.kind === "chat_response"
        ? await workspace.userMessage(actor(), params.workspaceId, acquired.job.operationId)
        : undefined;
    const context = await readWorkspaceContext(
      core,
      actor(),
      params.workspaceId,
      latest?.role === "user" ? latest : undefined,
      options.guideHosts,
    );
    const pipeline = await options.pipeline(acquired.job, lease, context);
    const fresh = async () => {
      if (
        !(await options.authorize(params.ownerId)) ||
        !(await jobs.renew(actor(), lease, new Date(Date.parse(clock()) + 300000).toISOString()))
      )
        throw new ModelError("MODEL_UNAVAILABLE");
    };
    await fresh();
    let written = false;
    if (acquired.job.kind === "intake_questions") {
      const questions = await pipeline.questions(context, params.jobId);
      await fresh();
      written = await workspace.writeBatch(
        guard(),
        {
          id: crypto.randomUUID(),
          ordinal: context.intake.batches.length + 1,
          generatedForIntakeRevision: context.intake.revision,
          questions,
          answers: [],
        },
        lease,
      );
    } else if (acquired.job.kind === "intake_summary") {
      const draft = await pipeline.summary(context, params.jobId);
      await fresh();
      const row = await core
        .statement(
          "SELECT coalesce(max(revision),0)+1 revision FROM v2_summaries WHERE workspace_id=?",
          [params.workspaceId],
        )
        .first<{ revision: number }>();
      const summary = v2SummarySchema.parse({
        ...draft,
        schemaVersion: "2",
        revision: row?.revision ?? 1,
        intakeRevision: context.intake.revision,
        createdAt: clock(),
      });
      const id = crypto.randomUUID(),
        text = JSON.stringify(summary),
        parts = fragmentText(text),
        staging = createV2StagingRepository(core),
        entities = createV2SummaryStagingRepository(core);
      if (
        !(await staging.begin(
          guard(),
          {
            id,
            purpose: "summary",
            targetId: params.workspaceId,
            revision: summary.revision,
            partCount: parts.length,
            byteLength: utf8Bytes(text),
          },
          lease,
        ))
      )
        throw new Error("Stale summary");
      for (const [index, part] of parts.entries())
        if (!(await staging.append(guard(), id, index, part, lease)))
          throw new Error("Stale summary");
      for (const fact of summary.facts)
        if (!(await entities.stagePage(guard(), id, { facts: [fact], parties: [] }, lease)))
          throw new Error("Stale fact");
      for (let index = 0; index < summary.parties.length; index += 4)
        if (
          !(await entities.stagePage(
            guard(),
            id,
            { facts: [], parties: summary.parties.slice(index, index + 4) },
            lease,
          ))
        )
          throw new Error("Stale party");
      if (
        !(await staging.seal(
          guard(),
          id,
          {
            schemaVersion: "2",
            purpose: "summary",
            targetId: params.workspaceId,
            revision: summary.revision,
          },
          lease,
        ))
      )
        throw new Error("Stale summary");
      await fresh();
      written = await entities.publish(
        guard(),
        id,
        {
          summaryId: crypto.randomUUID(),
          summaryRevision: summary.revision,
          intakeRevision: summary.intakeRevision,
          factCount: summary.facts.length,
          partyCount: summary.parties.length,
        },
        lease,
      );
    } else if (acquired.job.kind === "chat_response") {
      const response = await pipeline.chat(context, params.jobId);
      await fresh();
      written = await createV2WorkspaceResponseRepository(core, options.guideHosts).commit(
        guard(),
        lease,
        {
          message: {
            schemaVersion: "2",
            id: crypto.randomUUID(),
            operationId: acquired.job.operationId,
            workspaceRevision: params.workspaceRevision,
            createdAt: clock(),
            role: "assistant",
            safety: "validated",
            text: response.text,
            references: response.references,
            citations: response.citations,
            warnings: response.warnings,
          },
          facts: response.facts,
          parties: response.parties,
          actions: response.actions,
          timeline: response.timeline,
        },
      );
    }
    if (!written) throw new Error("Workspace changed");
    return { jobId: params.jobId, status: "completed" as const };
  } catch (error) {
    await jobs
      .fail(
        actor(),
        lease,
        error instanceof ModelError ? error.code : "INTERNAL_ERROR",
        error instanceof ModelError && error.code === "MODEL_UNAVAILABLE",
      )
      .catch(() => false);
    return { jobId: params.jobId, status: "failed" as const };
  }
}
