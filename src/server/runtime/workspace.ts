import { drizzle } from "drizzle-orm/d1";
import { readAccountType } from "../auth/account-type";
import { createCaseDataCipher } from "../crypto";
import * as schema from "../db/schema";
import { createV2AccountingRepository } from "../db/v2-accounting";
import { createV2Core, type V2Core } from "../db/v2-core";
import { createV2OfficialSourceRepository } from "../db/v2-official-sources";
import {
  reportLegalOutcome,
  reportLegalRejection,
  reportLegalRequest,
  reportLegalRetrieval,
} from "../dependency-diagnostics";
import type { GatewayExecutionBinding } from "../modules/budget/gateway-ledger";
import { configuredBounds } from "../modules/budget/model-configuration";
import {
  type QuotationResolution,
  safeQuotationResolution,
} from "../modules/citation/quotation-spans";
import { hasCurrentConsent } from "../modules/consent/service";
import { lookupCatalog, lookupConfiguration } from "../modules/external-tools/catalog";
import { createWorkspaceLookupRound } from "../modules/external-tools/execution";
import {
  type ComparisonEvidenceObservation,
  comparisonEvidenceObservationSchema,
} from "../modules/legal-retrieval/research/comparison";
import {
  createPrecedentResearchService,
  PrecedentResearchError,
} from "../modules/legal-retrieval/research/service";
import { GUIDE_HOSTS } from "../modules/legal-retrieval/v2/registry";
import { createV2LegalRetrieval } from "../modules/legal-retrieval/v2/service";
import {
  isWorkspacePublicQuery,
  workspaceRetrievalPlans,
} from "../modules/legal-retrieval/v2/workspace-plans";
import { projectWorkspaceSources } from "../modules/legal-retrieval/v2/workspace-sources";
import type { Phase } from "../modules/llm-gateway/prompts";
import { ModelError } from "../modules/llm-gateway/service";
import { readWorkspaceContext, workspaceCalendar } from "../modules/workspace/context";
import { currentTime } from "../modules/workspace/current-time";
import { createWorkspaceDispatcher } from "../modules/workspace/dispatch";
import { executeWorkspace, type WorkspaceParams } from "../modules/workspace/execution";
import { MATERIAL_CONTEXT_BYTES, readMaterialWindow } from "../modules/workspace/materials";
import { createWorkspacePipeline } from "../modules/workspace/pipeline";
import type { WorkspaceDependencies } from "../modules/workspace/service";
import {
  createWorkspaceGatewayBudget as budget,
  createLeasedWorkspaceGateway,
  readWorkspaceGatewayAdmission,
  gatewayAttemptRequest as request,
} from "./gateway";
import { readProcessingProofs } from "./processing-proofs";

/** Both account types may use their own workspace; consent remains mandatory. */
export async function hasCustomerWorkspaceAccess(core: V2Core, ownerId: string) {
  return (
    ["customer", "lawyer"].includes(await readAccountType(core.binding, ownerId)) &&
    (await hasCurrentConsent(drizzle(core.binding, { schema }), ownerId))
  );
}

export { configuredBounds } from "../modules/budget/model-configuration";
export { workspaceTokenBounds } from "./gateway";

const phaseFor = (kind: string, comparison = false): Phase =>
  comparison
    ? "workspace_precedent_compare"
    : kind === "intake_questions"
      ? "workspace_questions"
      : kind === "intake_summary"
        ? "workspace_summary"
        : "workspace_chat";
export function createWorkspaceDependencies(core: V2Core, env: Env): WorkspaceDependencies {
  return {
    guideHosts: GUIDE_HOSTS,
    dispatch: () =>
      createWorkspaceDispatcher(core, { binding: env.WORKSPACE_PROCESSING }).dispatch(4),
    async prepareJob(input) {
      if (!(await hasCustomerWorkspaceAccess(core, input.ownerId))) return null;
      if (
        !env.WORKSPACE_PROCESSING ||
        !env.AI ||
        !env.AI_GATEWAY_ID?.trim() ||
        !configuredBounds(env)
      )
        return null;
      const now = new Date().toISOString(),
        proofs = await readProcessingProofs(
          core,
          env.APP_ENV === "production" ? "production" : "preview",
          now,
          "model_input_tokens",
        );
      if (!proofs) return null;
      // Text-only customers have not gone through file admission, which also
      // initializes this account-owned ledger identity. Repair existing accounts
      // here before preparing their first paid workspace hold.
      if (
        !(await createV2AccountingRepository(core).ensurePrincipal({ ownerId: input.ownerId, now }))
      )
        return null;
      const latest =
        input.retryMessage ??
        (input.chat
          ? {
              schemaVersion: "2" as const,
              id: input.chat.id,
              operationId: input.admission.operationId,
              workspaceRevision: input.revision,
              createdAt: now,
              role: "user" as const,
              text: input.chat.request.text,
              selectedFileIds: input.chat.request.selectedFileIds,
              ...(input.chat.precedentComparisonRequest
                ? { precedentComparisonRequest: input.chat.precedentComparisonRequest }
                : {}),
            }
          : undefined);
      const context = await readWorkspaceContext(
        core,
        { ownerId: input.ownerId, now },
        input.caseId,
        latest,
        GUIDE_HOSTS,
        input.chat?.precedentComparisonRequest ? "precedent_comparison" : "full",
      );
      const comparison = input.chat?.precedentComparisonRequest;
      if (comparison) {
        if (
          comparison.expectedRevision !== input.revision - 1 ||
          comparison.summaryRevision !== context.confirmedSummary?.revision
        )
          throw new PrecedentResearchError("CONFLICT");
        const source = await createPrecedentResearchService(core, env).read(
          input.ownerId,
          input.caseId,
          {
            expectedRevision: comparison.expectedRevision,
            readToken: comparison.readToken,
          },
        );
        context.precedentComparison = {
          basedOnWorkspaceRevision: comparison.expectedRevision,
          summaryRevision: comparison.summaryRevision,
          source: { citation: source.citation, excerpt: source.excerpt },
        };
      }
      const invocationId = crypto.randomUUID(),
        phase = phaseFor(input.kind, !!context.precedentComparison);
      if (input.kind === "chat_response" && !context.precedentComparison) {
        context.clockTool = { id: "current_time", timeZone: "Asia/Seoul" };
        context.lookupTools = lookupCatalog(lookupConfiguration(env));
        context.toolLookupPerformed = false;
        context.toolResults = [];
      }
      const binding: GatewayExecutionBinding = {
        ...proofs,
        operationId: input.admission.operationId,
        operationRevision: input.operationRevision ?? input.revision,
        requestHash: input.admission.requestHash,
        jobId: input.jobId,
        targetKind: "workspace",
        targetId: input.caseId,
        targetRevision: input.revision,
        invocationId,
        maximumAttempts: 3,
        deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await request(phase, context, invocationId, input.jobId);
        const prepared = await budget(core, env, input.ownerId, context).prepareAdmission(
          binding,
          r,
        );
        if (!prepared) return null;
        const calendar = workspaceCalendar(prepared.actor.now);
        if (context.calendar?.localDate === calendar.localDate)
          return { paid: prepared.paid, actor: prepared.actor };
        // Midnight may pass while reading context. These are uncommitted SQL
        // capabilities, not a persisted hold or provider call. Re-prepare once
        // so the eventual immutable plan.created_at and complete wire agree.
        // sourceRetrieval.asOfDate retains its actual context-read day.
        context.calendar = calendar;
      }
      return null;
    },
  };
}
export async function runWorkspaceRuntime(
  env: Env,
  params: WorkspaceParams,
  instanceId: string,
  waitUntil: (work: Promise<void>) => void,
) {
  const core = createV2Core(env.DB, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  const legalRetrieval: ReturnType<typeof reportLegalRetrieval>[] = [];
  let quotationResolution: QuotationResolution | undefined;
  const comparisonEvidence: ComparisonEvidenceObservation[] = [];
  const result = await executeWorkspace(core, params, instanceId, {
    guideHosts: GUIDE_HOSTS,
    authorize: (ownerId) => hasCustomerWorkspaceAccess(core, ownerId),
    pipeline: async (job, lease, context, progress, latest) => {
      const comparison = latest?.precedentComparisonRequest;
      if (comparison) {
        const source = await createPrecedentResearchService(core, env).readForExecution(
          params.ownerId,
          params.workspaceId,
          comparison,
          params.workspaceRevision,
        );
        const citation = source.citation;
        const bound = await core
          .statement("SELECT workspace_id,citation_json FROM v2_citation_bindings WHERE id=?", [
            citation.id,
          ])
          .first<{ workspace_id: string; citation_json: string }>();
        if (bound) {
          const previous = JSON.parse(bound.citation_json) as Record<string, unknown>;
          if (
            bound.workspace_id !== params.workspaceId ||
            previous._availability === "limited" ||
            !Object.entries(citation).every(([key, value]) => previous[key] === value)
          )
            throw new ModelError("POLICY_REJECTED");
        } else if (
          !(await createV2OfficialSourceRepository(core, GUIDE_HOSTS).bindCitation(
            {
              ownerId: params.ownerId,
              workspaceId: params.workspaceId,
              expectedRevision: params.workspaceRevision,
              now: new Date().toISOString(),
            },
            citation,
          ))
        )
          throw new ModelError("POLICY_REJECTED");
        context.precedentComparison = {
          basedOnWorkspaceRevision: comparison.expectedRevision,
          summaryRevision: comparison.summaryRevision,
          source: { citation, excerpt: source.excerpt },
        };
      }
      if (job.kind === "chat_response" && !context.precedentComparison) {
        context.clockTool = { id: "current_time", timeZone: "Asia/Seoul" };
        context.lookupTools = lookupCatalog(lookupConfiguration(env));
        context.toolLookupPerformed = false;
        context.toolResults = [];
      }
      const row = await readWorkspaceGatewayAdmission(
        core,
        env,
        job.id,
        params.workspaceRevision,
        new Date().toISOString(),
      );
      if (!row) throw new ModelError("MODEL_UNAVAILABLE");
      // Restore the admitted request day; authority/TTL still use the live clock.
      context.calendar = workspaceCalendar(row.created_at);
      const primary = phaseFor(job.kind, !!context.precedentComparison);
      let firstInvocation = true;
      const invocation = (phase: Phase) => {
        if (phase === primary && firstInvocation) {
          firstInvocation = false;
          return row.original.plan.invocationId;
        }
        return crypto.randomUUID();
      };
      const gateway = createLeasedWorkspaceGateway(core, env, {
        ownerId: params.ownerId,
        caseId: params.workspaceId,
        revision: params.workspaceRevision,
        jobId: job.id,
        operationId: job.operationId,
        lease,
        primary,
        admission: row,
        waitUntil,
        authorize: () => hasCustomerWorkspaceAccess(core, params.ownerId),
        onPhase: (phase) => progress.enter(phase === "workspace_audit" ? "audit" : "generation"),
      });
      return createWorkspacePipeline(gateway, {
        currentTime,
        reserve: async () => hasCustomerWorkspaceAccess(core, params.ownerId),
        invocation,
        ...(latest?.lookupRequests
          ? { explicitLookupTools: latest.lookupRequests.map((request) => request.tool) }
          : {}),
        lookup: async (tools) => {
          await progress.enter("retrieval");
          return createWorkspaceLookupRound(core, lookupConfiguration(env), {
            ownerId: params.ownerId,
            lease,
            latest,
            authorize: async () => {
              if (!(await hasCustomerWorkspaceAccess(core, params.ownerId))) return false;
              return !!(await core
                .statement(
                  "SELECT id FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND status IN ('running','validating') AND EXISTS(SELECT 1 FROM v2_workspaces WHERE id=? AND owner_id=? AND current_job_id=v2_jobs.id AND revision=?)",
                  [
                    job.id,
                    lease.token,
                    lease.fencing,
                    new Date().toISOString(),
                    params.workspaceId,
                    params.ownerId,
                    params.workspaceRevision,
                  ],
                )
                .first());
            },
          })(tools);
        },
        observeQuotationResolution: (value) => {
          quotationResolution = safeQuotationResolution(value);
        },
        observeComparisonEvidence: (value) => {
          const parsed = comparisonEvidenceObservationSchema.safeParse(value);
          if (parsed.success && comparisonEvidence.length < 3) comparisonEvidence.push(parsed.data);
        },
        readMaterials: async (context, requests) => {
          await progress.enter("retrieval");
          const authorize = async () =>
            (await hasCustomerWorkspaceAccess(core, params.ownerId)) &&
            !!(await core
              .statement(
                "SELECT j.id FROM v2_jobs j JOIN v2_workspaces w ON w.id=? AND w.owner_id=? AND w.current_job_id=j.id AND w.revision=? WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating')",
                [
                  params.workspaceId,
                  params.ownerId,
                  params.workspaceRevision,
                  job.id,
                  lease.token,
                  lease.fencing,
                  new Date().toISOString(),
                ],
              )
              .first());
          if (!(await authorize())) throw new ModelError("MODEL_UNAVAILABLE");
          const materials = [...context.materials];
          const windows = [...(context.materialWindows ?? [])];
          const seen = new Set(
            materials.map((material) => JSON.stringify([material.reference, material.text])),
          );
          let bytes = new TextEncoder().encode(JSON.stringify(materials)).byteLength;
          for (const request of requests) {
            const window = await readMaterialWindow(
              core,
              { ownerId: params.ownerId, now: new Date().toISOString() },
              params.workspaceId,
              request,
              MATERIAL_CONTEXT_BYTES * 2 - bytes,
            );
            const { materials: loaded, ...metadata } = window;
            windows.push(metadata);
            for (const material of loaded) {
              const key = JSON.stringify([material.reference, material.text]);
              if (seen.has(key)) continue;
              seen.add(key);
              materials.push(material);
              bytes += new TextEncoder().encode(JSON.stringify(material)).byteLength;
            }
          }
          if (!(await authorize())) throw new ModelError("MODEL_UNAVAILABLE");
          return { ...context, materials, materialWindows: windows };
        },
        retrieve: async (context, requests) => {
          await progress.enter("retrieval");
          const sourceRepository = createV2OfficialSourceRepository(core, GUIDE_HOSTS);
          const authorize = async () => {
            if (!(await hasCustomerWorkspaceAccess(core, params.ownerId))) return false;
            return !!(await core
              .statement(
                "SELECT id FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=? AND lease_until>? AND status IN ('running','validating') AND EXISTS(SELECT 1 FROM v2_workspaces WHERE id=? AND owner_id=? AND current_job_id=v2_jobs.id AND revision=?)",
                [
                  job.id,
                  lease.token,
                  lease.fencing,
                  new Date().toISOString(),
                  params.workspaceId,
                  params.ownerId,
                  params.workspaceRevision,
                ],
              )
              .first());
          };
          const retrieval = createV2LegalRetrieval(env, sourceRepository, {
            observeRequest: reportLegalRequest,
            observeOutcome: reportLegalOutcome,
            observeUpstreamRejection: reportLegalRejection,
            bindCitation: (citation) =>
              sourceRepository.bindCitation(
                {
                  ownerId: params.ownerId,
                  workspaceId: params.workspaceId,
                  expectedRevision: params.workspaceRevision,
                  now: new Date().toISOString(),
                },
                citation,
              ),
          });
          const now = new Date().toISOString();
          let attempts = 0;
          const output = await retrieval.retrieve(
            {
              now,
              asOfDate: new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10),
              plans: workspaceRetrievalPlans(requests),
            },
            {
              authorize,
              authorizeQuery: async (query) => isWorkspacePublicQuery(query) && (await authorize()),
              reserveRequest: async () => ++attempts <= 12 && (await authorize()),
              signal: AbortSignal.timeout(120000),
            },
          );
          for (const outcome of output.outcomes) legalRetrieval.push(reportLegalRetrieval(outcome));
          const sources = await projectWorkspaceSources(output);
          return {
            ...context,
            ...sources,
            references: {
              ...context.references,
              verifiedCitationIds: sources.citations.map((citation) => citation.id),
            },
          };
        },
      });
    },
  });
  // The internal Workflow receipt remains inspectable when a console event is absent.
  // Public job responses still come from the unchanged repository contract.
  return {
    ...result,
    ...(legalRetrieval.length ? { legalRetrieval } : {}),
    ...(quotationResolution ? { quotationResolution } : {}),
    ...(comparisonEvidence.length ? { comparisonEvidence } : {}),
  };
}
