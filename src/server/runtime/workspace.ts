import { drizzle } from "drizzle-orm/d1";
import { readAccountType } from "../auth/account-type";
import { createCaseDataCipher } from "../crypto";
import * as schema from "../db/schema";
import { createV2AccountingRepository } from "../db/v2-accounting";
import { createV2Core, type V2Core } from "../db/v2-core";
import { createV2JobsRepository } from "../db/v2-jobs";
import { createV2OfficialSourceRepository } from "../db/v2-official-sources";
import { reportLegalRetrieval, reportProviderFailure } from "../dependency-diagnostics";
import { paidHoldRequestSchema } from "../modules/budget/contracts";
import { createGatewayExecutionPlanner, type TokenBounds } from "../modules/budget/execution-plan";
import {
  createGatewayBudgetService,
  type GatewayExecutionBinding,
} from "../modules/budget/gateway-ledger";
import { configuredBounds } from "../modules/budget/model-configuration";
import {
  type QuotationResolution,
  safeQuotationResolution,
} from "../modules/citation/quotation-spans";
import { hasCurrentConsent } from "../modules/consent/service";
import { lookupCatalog, lookupConfiguration } from "../modules/external-tools/catalog";
import { createExternalTools } from "../modules/external-tools/service";
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
import type { GatewayAttemptRequest } from "../modules/llm-gateway/attempts";
import { MODEL_ID, type Phase } from "../modules/llm-gateway/prompts";
import {
  createLlmGateway,
  gatewayWireIdentity,
  ModelError,
  prepareGatewayWireInput,
  WORKSPACE_MODEL_TIMEOUT_MS,
} from "../modules/llm-gateway/service";
import { readWorkspaceContext, workspaceCalendar } from "../modules/workspace/context";
import { createWorkspaceDispatcher } from "../modules/workspace/dispatch";
import { executeWorkspace, type WorkspaceParams } from "../modules/workspace/execution";
import { MATERIAL_CONTEXT_BYTES, readMaterialWindow } from "../modules/workspace/materials";
import { createWorkspacePipeline, workspaceModelInput } from "../modules/workspace/pipeline";
import type { WorkspaceDependencies } from "../modules/workspace/service";
import { readProcessingProofs } from "./processing-proofs";

/** Role changes revoke future dispatch/publication without erasing paid receipts. */
export async function hasCustomerWorkspaceAccess(core: V2Core, ownerId: string) {
  return (
    (await readAccountType(core.binding, ownerId)) === "customer" &&
    (await hasCurrentConsent(drizzle(core.binding, { schema }), ownerId))
  );
}

export { configuredBounds } from "../modules/budget/model-configuration";

/** The same complete-wire reservation is used by admission and configuration inspection. */
export function workspaceTokenBounds(
  config: ReturnType<typeof configuredBounds>,
  outputCap: number,
): TokenBounds | null {
  if (!config) return null;
  if (config.bounds.basis !== "verified_model_context_limit") return config.bounds as TokenBounds;
  // A complete context reservation includes this exact output cap. No text/token heuristic.
  const inputLimit = config.bounds.modelContextTokenLimit - outputCap;
  if (inputLimit <= 0 || inputLimit > config.bounds.modelInputTokenLimit || config.bounds.vision)
    return null;
  return {
    ...config.bounds,
    textTokensUpperBound: inputLimit,
    framingTokensUpperBound: 0,
    modelInputTokenLimit: inputLimit,
  } as TokenBounds;
}
const phaseFor = (kind: string, comparison = false): Phase =>
  comparison
    ? "workspace_precedent_compare"
    : kind === "intake_questions"
      ? "workspace_questions"
      : kind === "intake_summary"
        ? "workspace_summary"
        : "workspace_chat";
async function request(
  phase: Phase,
  input: unknown,
  invocationId: string,
  requestId: string,
): Promise<GatewayAttemptRequest> {
  const wire = prepareGatewayWireInput(phase, workspaceModelInput(input));
  return {
    invocationId,
    requestId,
    phase,
    model: MODEL_ID,
    attemptOrdinal: 1,
    correction: false,
    ...(await gatewayWireIdentity(wire)),
    outputTokenUpperBound: wire.max_completion_tokens,
  };
}
function budget(core: V2Core, env: Env, ownerId: string, input: unknown) {
  const config = configuredBounds(env);
  const planner = createGatewayExecutionPlanner({
    applicationCostLimitsEnabled: core.applicationCostLimitsEnabled,
    input: async () => workspaceModelInput(input),
    bounds: async (wire) => workspaceTokenBounds(config, wire.max_completion_tokens),
    verifyBounds: async (_descriptor, digest, now) =>
      config && Date.parse(config.verifiedAt) <= Date.parse(now)
        ? { digest, evidenceHash: config.evidenceHash, verifiedAt: config.verifiedAt }
        : null,
  });
  return createGatewayBudgetService({
    core,
    environment: env.APP_ENV === "production" ? "production" : "preview",
    ownerId,
    execution: planner.verify,
  });
}
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
        context.lookupTools = lookupCatalog(lookupConfiguration(env));
        context.toolLookupPerformed = false;
        context.toolResults = [];
      }
      const row = await core
        .statement(
          "SELECT h.attempt_id,p.payload_json,p.created_at,c.allocation_proof_id FROM v2_execution_job_holds h JOIN v2_execution_job_plans p ON p.id=h.plan_id JOIN v2_execution_attempts a ON a.id=h.attempt_id LEFT JOIN v2_runtime_controls c ON c.month=a.month AND c.environment=? WHERE h.job_id=? AND h.state='prepared' AND p.target_revision=? AND p.deadline_at>? ORDER BY h.attempt_id LIMIT 1",
          [
            env.APP_ENV === "production" ? "production" : "preview",
            job.id,
            params.workspaceRevision,
            new Date().toISOString(),
          ],
        )
        .first<{
          attempt_id: string;
          payload_json: string;
          created_at: string;
          allocation_proof_id: string;
        }>();
      if (!row) throw new ModelError("MODEL_UNAVAILABLE");
      const original = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
      // Restore the same request-day input even when dispatch crosses midnight.
      // Lease, consent, source expiry and provider receipts still use the live clock.
      // Source retrieval also keeps its actual read/retrieval day, independently.
      context.calendar = workspaceCalendar(row.created_at);
      const primary = phaseFor(job.kind, !!context.precedentComparison);
      let firstInvocation = true,
        initialUsed = false;
      const invocation = (phase: Phase) => {
        if (phase === primary && firstInvocation) {
          firstInvocation = false;
          return original.plan.invocationId;
        }
        return crypto.randomUUID();
      };
      const gateway: ReturnType<typeof createLlmGateway> = {
        async call(phase, input, requestId, reserve, reserveCorrection, invocationId) {
          await progress.enter(phase === "workspace_audit" ? "audit" : "generation");
          if (!(await hasCustomerWorkspaceAccess(core, params.ownerId)))
            throw new Error("Customer access unavailable");
          const currentId = invocationId ?? invocation(phase),
            now = new Date().toISOString();
          // Generation, correction and independent audit can span several minutes.
          // Renew only this live fenced lease before each separately paid phase.
          if (
            !(await createV2JobsRepository(core).renew(
              { ownerId: params.ownerId, now },
              lease,
              new Date(Date.parse(now) + 300000).toISOString(),
            ))
          )
            throw new ModelError("MODEL_UNAVAILABLE");
          const service = budget(core, env, params.ownerId, input);
          const useInitial = phase === primary && !initialUsed;
          const binding: GatewayExecutionBinding = {
            operationId: job.operationId,
            operationRevision: original.plan.operationRevision,
            requestHash: original.plan.requestHash,
            jobId: job.id,
            targetKind: "workspace",
            targetId: params.workspaceId,
            targetRevision: params.workspaceRevision,
            invocationId: currentId,
            maximumAttempts: 3,
            deadlineAt: useInitial
              ? original.plan.deadlineAt
              : new Date(Date.parse(now) + 300000).toISOString(),
            pricingProofId: original.pricingProofId,
            fundingProofId: original.fundingProofId,
            allocationProofId: row.allocation_proof_id,
          };
          const initial = useInitial
            ? await service.restoreAdmission(
                binding,
                await request(phase, input, currentId, requestId),
                row.attempt_id,
              )
            : null;
          // A queued admission may predate the deployed prompt/wire/catalog.
          // Never rewrite its proof or dispatch with it. A fresh explicit retry
          // must obtain a new immutable admission under all existing guards.
          if (useInitial && !initial) throw new ModelError("MODEL_UNAVAILABLE");
          initialUsed = true;
          const ledger = service.createLedger({
            binding,
            ...(initial ? { initial } : {}),
            waitUntil,
            lease: async () => {
              const r = await core
                .statement(
                  "SELECT lease_until FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=?",
                  [job.id, lease.token, lease.fencing],
                )
                .first<{ lease_until: string }>();
              if (!r) throw new Error("Lease unavailable");
              return { lease, expiresAt: r.lease_until };
            },
          });
          return createLlmGateway(env, {
            attemptLedger: ledger,
            observeFailure: reportProviderFailure,
            // Observed model responses can exceed one minute. Each phase still
            // fits its renewed five-minute lease; timeout never retries a live call.
            timeoutMs: WORKSPACE_MODEL_TIMEOUT_MS,
          }).call(phase, input, requestId, reserve, reserveCorrection, currentId);
        },
      };
      return createWorkspacePipeline(gateway, {
        reserve: async () => hasCustomerWorkspaceAccess(core, params.ownerId),
        invocation,
        lookup: async (tools) => {
          await progress.enter("retrieval");
          const service = createExternalTools(lookupConfiguration(env));
          const results = [];
          for (const tool of tools) {
            results.push(
              await service.execute(tool, null, {
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
                // Targets are never inferred from chat. Until a separate explicit
                // target/recipient-consent flow exists, no network claim is issued.
                reserve: async () => false,
                signal: new AbortController().signal,
              }),
            );
          }
          return results;
        },
        observeQuotationResolution: (value) => {
          quotationResolution = safeQuotationResolution(value);
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
  };
}
