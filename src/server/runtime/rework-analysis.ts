import type { V2ConversationActionRequest, V2FailureCode } from "../../contracts/v2";
import { createV2AccountingRepository, quotaTransitionStatements } from "../db/v2-accounting";
import { aliveWorkspace, sqlClaim, type V2Core, type WorkspaceGuard } from "../db/v2-core";
import { createV2JobsRepository } from "../db/v2-jobs";
import { createV2ReworkRepository } from "../db/v2-rework";
import { prepareReworkJobAdmission } from "../db/v2-rework-jobs";
import { completeLeaseStatements } from "../db/v2-workspace";
import { configuredBounds } from "../modules/budget/model-configuration";
import {
  analysisBasis,
  analysisCaseFacts,
  canonicalAnalysisJson,
  type LegalAnalysisInput,
} from "../modules/legal-retrieval/analysis/context";
import { createLegalAnalysisRuntimeAdapter } from "../modules/legal-retrieval/analysis/runtime-adapter";
import { textHash } from "../modules/legal-retrieval/service";
import { capturePublicationSourceAuthority } from "../modules/legal-retrieval/v2/publication-authority";
import { GUIDE_HOSTS } from "../modules/legal-retrieval/v2/registry";
import type { Transport } from "../modules/legal-retrieval/v2/transport";
import { ModelError } from "../modules/llm-gateway/service";
import {
  buildProcedureSources,
  selectReviewedProcedurePlans,
} from "../modules/resolution/procedure-sources";
import { loadAnalysisInput, readAnalysisScope } from "../modules/rework/analysis-input";
import { ReworkError } from "../modules/rework/case-context";
import {
  analysisTaskSchema,
  preparedAnalysisRecordSchema,
  procedureSourcesSchema,
} from "../modules/rework/records";
import { reworkAccess } from "../modules/rework/state";
import { workspaceCalendar } from "../modules/workspace/context";
import { createWorkspaceDispatcher } from "../modules/workspace/dispatch";
import type { WorkspaceParams } from "../modules/workspace/execution";
import {
  createLeasedWorkspaceGateway,
  createWorkspaceGatewayBudget,
  gatewayAttemptRequest,
  readWorkspaceGatewayAdmission,
} from "./gateway";
import { readProcessingProofs } from "./processing-proofs";

// Keep the same key insertion order as createAutomaticLegalAnalysis.plan().
export function legalPlanningInput(input: LegalAnalysisInput, asOfDate: string) {
  const value = { ...input, facts: analysisCaseFacts(input), asOfDate };
  value.confirmedSummary = { ...input.confirmedSummary, facts: value.facts };
  return value;
}
export function createLegalAnalysisJobs(
  core: V2Core,
  env: Env,
  deps: {
    clock?: () => string;
    waitUntil?: (work: Promise<void>) => void;
    /** Constructor-only official-source transport for offline tests, never HTTP input. */
    transport?: Transport;
    prepareReport?: (
      ownerId: string,
      caseId: string,
      requestId: string,
      expectedRevision: number | null,
    ) => Promise<void>;
  } = {},
) {
  const clock = deps.clock ?? (() => new Date().toISOString()),
    records = createV2ReworkRepository(core, { clock }),
    jobs = createV2JobsRepository(core),
    accounting = createV2AccountingRepository(core);
  const actor = (ownerId: string) => ({ ownerId, now: clock() });
  const assertAccess = async (ownerId: string, caseId: string) => {
    if (!(await reworkAccess(core, ownerId, caseId))) throw new ReworkError("NOT_FOUND");
    if (!(await reworkAccess(core, ownerId, caseId, true)))
      throw new ReworkError("CONSENT_REQUIRED");
  };
  const replay = async (ownerId: string, caseId: string, key: string, requestHash: string) => {
    const found = await accounting.findOperation(
      actor(ownerId),
      `/api/v2/cases/${caseId}/rework/tasks/legal_analysis`,
      key,
      requestHash,
    );
    if (found?.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
    if (!found) return null;
    const job = await core
      .statement(
        "SELECT id,target_revision FROM v2_jobs WHERE operation_id=? AND workspace_id=? AND target_kind='workspace' ORDER BY id LIMIT 1",
        [found.operation.id, caseId],
      )
      .first<{ id: string; target_revision: number }>();
    if (!job) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    return { operationId: job.id, workspaceRevision: job.target_revision };
  };
  return {
    replay,
    async admit(
      ownerId: string,
      caseId: string,
      request: {
        requestId: string;
        expectedRevision: number;
        continueWithReport: boolean;
        reportExpectedRevision?: number | null;
        actionRequest?: V2ConversationActionRequest;
      },
    ) {
      await assertAccess(ownerId, caseId);
      const requestHash = await textHash(canonicalAnalysisJson(request.actionRequest ?? request));
      const previous = await replay(ownerId, caseId, request.requestId, requestHash);
      if (previous) return previous;
      const a = actor(ownerId),
        scope = await readAnalysisScope(core, a, caseId);
      const priorReport = await core
        .statement(
          "SELECT r.revision FROM v2_reports r JOIN v2_workspaces w ON w.id=r.workspace_id WHERE w.id=? AND w.owner_id=? AND r.id NOT LIKE 'export-%' AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='report' AND target_id=r.id) ORDER BY r.revision DESC,r.id DESC LIMIT 1",
          [caseId, ownerId],
        )
        .first<number>("revision");
      const loaded = await loadAnalysisInput(core, a, caseId, scope);
      if (loaded.workspace.workspaceRevision !== request.expectedRevision)
        throw new ReworkError("STALE_REVISION");
      if (!loaded.input || loaded.context.casePurpose === "unconfirmed")
        throw new ReworkError("REVIEW_REQUIRED");
      if (loaded.pendingEvidenceIds.length) throw new ReworkError("REVIEW_REQUIRED");
      if (loaded.workspace.currentJobId) throw new ReworkError("STALE_REVISION");
      if (
        !env.WORKSPACE_PROCESSING ||
        !env.AI ||
        !env.AI_GATEWAY_ID?.trim() ||
        !configuredBounds(env)
      )
        throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const usage = await accounting.usage(a);
      if (usage.aiResponses.used + usage.aiResponses.reserved >= usage.aiResponses.limit)
        throw new ReworkError("USER_QUOTA_EXCEEDED");
      if (!(await accounting.ensurePrincipal(a))) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const proofs = await readProcessingProofs(
        core,
        env.APP_ENV === "production" ? "production" : "preview",
        a.now,
        "model_input_tokens",
      );
      if (!proofs) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID(),
        invocationIds = {
          workspace_legal_plan: crypto.randomUUID(),
          workspace_legal_analysis: crypto.randomUUID(),
          workspace_legal_audit: crypto.randomUUID(),
        },
        asOfDate = workspaceCalendar(a.now).localDate,
        planning = legalPlanningInput(loaded.input, asOfDate),
        target = request.expectedRevision + 1;
      const admission = await createWorkspaceGatewayBudget(
        core,
        env,
        ownerId,
        planning,
        clock,
      ).prepareAdmission(
        {
          ...proofs,
          operationId,
          operationRevision: target,
          requestHash,
          jobId,
          targetKind: "workspace",
          targetId: caseId,
          targetRevision: target,
          invocationId: invocationIds.workspace_legal_plan,
          maximumAttempts: 3,
          deadlineAt: new Date(Date.parse(a.now) + 300000).toISOString(),
        },
        await gatewayAttemptRequest(
          "workspace_legal_plan",
          planning,
          invocationIds.workspace_legal_plan,
          request.requestId,
        ),
      );
      if (!admission || workspaceCalendar(admission.actor.now).localDate !== asOfDate)
        throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const guard = {
        ...admission.actor,
        workspaceId: caseId,
        expectedRevision: request.expectedRevision,
      };
      const plan = await prepareReworkJobAdmission(
        core,
        guard,
        {
          admission: { operationId, key: request.requestId, requestHash },
          jobId,
          kind: "legal_analysis",
          summaryRevision: loaded.input.confirmedSummary.revision,
          authority: loaded.authority,
        },
        admission.paid,
      );
      if (!plan) throw new ReworkError("DEPENDENCY_UNAVAILABLE");
      const task = analysisTaskSchema.parse({
        format: "legal-analysis-task-v1",
        kind: "legal_analysis",
        jobId,
        operationId,
        requestId: request.requestId,
        ...(request.actionRequest ? { actionRequest: request.actionRequest } : {}),
        beforeWorkspaceRevision: request.expectedRevision,
        targetWorkspaceRevision: target,
        summaryRevision: loaded.input.confirmedSummary.revision,
        input: loaded.input,
        asOfDate,
        createdAt: admission.actor.now,
        invocationIds,
        continueWithReport: request.continueWithReport,
        reportExpectedRevision:
          request.reportExpectedRevision === undefined
            ? (priorReport ?? null)
            : request.reportExpectedRevision,
        limitations: loaded.limits,
      });
      const written = await records.write(guard, {
        kind: "task",
        entityId: jobId,
        expectedVersion: 0,
        schema: analysisTaskSchema,
        value: task,
        authority: plan.authority,
        statements: plan.statements,
        bumpWorkspace: true,
      });
      if (!written) {
        const won = await replay(ownerId, caseId, request.requestId, requestHash);
        if (won) return won;
        throw new ReworkError("STALE_REVISION");
      }
      return { operationId: jobId, workspaceRevision: target };
    },
    dispatch: () =>
      createWorkspaceDispatcher(core, { binding: env.WORKSPACE_PROCESSING }).dispatch(4),
    async execute(params: WorkspaceParams, instanceId: string) {
      const a = actor(params.ownerId);
      const stored = await records.read(
        a,
        params.workspaceId,
        "task",
        params.jobId,
        analysisTaskSchema,
      );
      if (!stored) return null;
      const task = stored.value,
        current = await jobs.find(a, params.jobId);
      if (current?.status === "completed")
        return { jobId: params.jobId, status: "completed" as const };
      if (
        !current ||
        task.jobId !== params.jobId ||
        task.targetWorkspaceRevision !== params.workspaceRevision ||
        current.target.kind !== "workspace" ||
        current.target.caseId !== params.workspaceId ||
        current.target.workspaceRevision !== params.workspaceRevision ||
        !(await reworkAccess(core, params.ownerId, params.workspaceId, true))
      )
        return { jobId: params.jobId, status: "stopped" as const };
      const runtime = await core
        .statement("SELECT runtime_instance_id FROM v2_jobs WHERE id=?", [params.jobId])
        .first<string>("runtime_instance_id");
      if (runtime !== instanceId) return { jobId: params.jobId, status: "stopped" as const };
      const initial = await readWorkspaceGatewayAdmission(
        core,
        env,
        task.jobId,
        params.workspaceRevision,
        clock(),
      );
      if (!initial) return { jobId: params.jobId, status: "stopped" as const };
      const acquisition = actor(params.ownerId);
      const acquired = await jobs.acquire(
        acquisition,
        task.jobId,
        crypto.randomUUID(),
        new Date(Date.parse(acquisition.now) + 300000).toISOString(),
        initial.attempt_id,
      );
      if (!acquired) return { jobId: task.jobId, status: "stopped" as const };
      const lease = acquired.lease;
      const guard = (): WorkspaceGuard => ({
        ...actor(params.ownerId),
        workspaceId: params.workspaceId,
        expectedRevision: params.workspaceRevision,
      });
      let loaded: Awaited<ReturnType<typeof loadAnalysisInput>> | undefined;
      const authorize = async () =>
        (await reworkAccess(core, params.ownerId, params.workspaceId, true)) &&
        !!(await core
          .statement(
            `SELECT w.id FROM v2_workspaces w JOIN v2_jobs j ON j.id=w.current_job_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND (${loaded?.authority.sql ?? "1"})`,
            [
              params.workspaceId,
              params.ownerId,
              params.workspaceRevision,
              task.jobId,
              lease.token,
              lease.fencing,
              clock(),
              ...(loaded?.authority.values ?? []),
            ],
          )
          .first());
      let checkpoint = 1;
      const phase = async (audit: boolean) => {
        if (
          !(await jobs.checkpoint(actor(params.ownerId), lease, {
            id: crypto.randomUUID(),
            revision: checkpoint++,
            phase: audit ? "validating" : "generating",
            progress: 0,
            opaqueIds: [],
          }))
        )
          throw new ModelError("MODEL_UNAVAILABLE");
      };
      try {
        loaded = await loadAnalysisInput(
          core,
          actor(params.ownerId),
          params.workspaceId,
          task.input.scope,
        );
        if (
          !loaded.input ||
          loaded.pendingEvidenceIds.length ||
          canonicalAnalysisJson(loaded.input) !== canonicalAnalysisJson(task.input) ||
          task.asOfDate !== workspaceCalendar(clock()).localDate
        )
          throw new ReworkError("STALE_REVISION");
        const gateway = createLeasedWorkspaceGateway(core, env, {
          ownerId: params.ownerId,
          caseId: params.workspaceId,
          revision: params.workspaceRevision,
          jobId: task.jobId,
          operationId: task.operationId,
          lease,
          primary: "workspace_legal_plan",
          admission: initial,
          authorize,
          waitUntil: deps.waitUntil ?? (() => {}),
          clock,
          onPhase: (p) => phase(p === "workspace_legal_audit"),
        });
        let requests = 0;
        const adapter = createLegalAnalysisRuntimeAdapter({
          core,
          env,
          additionalPlans: selectReviewedProcedurePlans(task.input.context),
          guard: guard(),
          requestId: task.requestId,
          gateway,
          clock,
          ...(deps.transport ? { transport: deps.transport } : {}),
          authorize,
          reserveRequest: async () => ++requests <= 12 && authorize(),
          modelAdmission: {
            invocationId: (p) => task.invocationIds[p],
            reserve: authorize,
            reserveCorrection: authorize,
          },
        });
        const result = await adapter.prepare(task.input);
        const procedure = procedureSourcesSchema.parse(
          await buildProcedureSources({
            context: task.input.context,
            asOfDate: task.asOfDate,
            now: clock(),
            outcomes: result.sourceRetrieval.outcomes,
          }),
        );
        const snapshot = {
          ...result.snapshot,
          status:
            result.snapshot.status === "ready" && task.limitations.length
              ? ("partial" as const)
              : result.snapshot.status,
          limitations: [
            ...new Set([
              ...result.snapshot.limitations,
              ...task.limitations,
              ...procedure.limitations.map((l) => l.action),
            ]),
          ].slice(0, 100),
        };
        const citations = [...snapshot.citations, ...procedure.citations];
        const sourceAuthority = await capturePublicationSourceAuthority(
          core,
          guard(),
          citations.map((c) => ({ kind: "official_source" as const, citationId: c.id })),
          citations,
          GUIDE_HOSTS,
        );
        if (!sourceAuthority || !(await authorize())) throw new ReworkError("STALE_REVISION");
        const caseAuthority = loaded.authority;
        const prior = await records.head(
          actor(params.ownerId),
          params.workspaceId,
          "analysis",
          params.workspaceId,
        );
        const publication = await records.write(guard(), {
          kind: "analysis",
          expectedVersion: prior?.revision ?? 0,
          lease,
          bumpWorkspace: true,
          schema: preparedAnalysisRecordSchema,
          value: {
            format: "prepared-legal-analysis-v1",
            basis: snapshot.basis,
            scope: task.input.scope,
            snapshot,
            failure: null,
            completedAt: clock(),
            ...(task.continueWithReport
              ? {
                  continuationObligation: {
                    requestId: task.requestId,
                    expectedReportRevision: task.reportExpectedRevision ?? null,
                  },
                }
              : {}),
            procedureCitations: procedure.citations,
            procedureSources: procedure,
          },
          authority: (now) => ({
            sql: `(${caseAuthority.sql}) AND (${sourceAuthority.sql})`,
            values: [...caseAuthority.values, ...sourceAuthority.values(now)],
          }),
          statements: (claim) => [
            ...completeLeaseStatements(core, lease, claim, clock()),
            core.statement(
              `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
              [params.workspaceId, claim],
            ),
          ],
        });
        if (!publication) throw new ReworkError("STALE_REVISION");
        if (task.continueWithReport)
          await deps.prepareReport?.(
            params.ownerId,
            params.workspaceId,
            task.requestId,
            task.reportExpectedRevision ?? null,
          );
        return { jobId: task.jobId, status: "completed" as const };
      } catch (error) {
        // A downstream report failure cannot undo a completed analysis job.
        if ((await jobs.find(actor(params.ownerId), task.jobId))?.status === "completed")
          return { jobId: task.jobId, status: "completed" as const };
        // Authority loss cannot publish facts or release an ambiguous execution.
        const code = (error as { code?: string })?.code;
        const failure: V2FailureCode =
          code === "MODEL_SCHEMA_INVALID" || code === "POLICY_REJECTED"
            ? code
            : code === "SOURCE_UNAVAILABLE"
              ? "LEGAL_SOURCE_UNAVAILABLE"
              : code === "STALE_REVISION"
                ? "POLICY_REJECTED"
                : "MODEL_UNAVAILABLE";
        if (!(await authorize())) return { jobId: task.jobId, status: "stopped" as const };
        const prior = await records.head(
          actor(params.ownerId),
          params.workspaceId,
          "analysis",
          params.workspaceId,
        );
        const written = await records.write(guard(), {
          kind: "analysis",
          expectedVersion: prior?.revision ?? 0,
          lease,
          bumpWorkspace: true,
          schema: preparedAnalysisRecordSchema,
          value: {
            format: "prepared-legal-analysis-v1",
            basis: await analysisBasis(task.input),
            scope: task.input.scope,
            snapshot: null,
            failure,
            completedAt: clock(),
            ...(task.continueWithReport
              ? {
                  continuationObligation: {
                    requestId: task.requestId,
                    expectedReportRevision: task.reportExpectedRevision ?? null,
                  },
                }
              : {}),
            procedureCitations: [],
          },
          ...(loaded ? { authority: loaded.authority } : {}),
          statements: (claim) => [
            core.statement(
              `UPDATE v2_jobs SET status='failed',failure_code=?,retryable=0,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${sqlClaim}`,
              [failure, clock(), task.jobId, claim],
            ),
            core.statement(`UPDATE v2_operations SET state='failed' WHERE id=? AND ${sqlClaim}`, [
              task.operationId,
              claim,
            ]),
            ...quotaTransitionStatements(core, task.jobId, claim, "released", undefined, true),
            core.statement(
              `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
              [params.workspaceId, claim],
            ),
          ],
        });
        if (written && task.continueWithReport)
          await deps.prepareReport?.(
            params.ownerId,
            params.workspaceId,
            task.requestId,
            task.reportExpectedRevision ?? null,
          );
        return { jobId: task.jobId, status: written ? ("failed" as const) : ("stopped" as const) };
      }
    },
  };
}
