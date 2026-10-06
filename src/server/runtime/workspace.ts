import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { readAccountType } from "../auth/account-type";
import { createCaseDataCipher } from "../crypto";
import * as schema from "../db/schema";
import { createV2AccountingRepository } from "../db/v2-accounting";
import { createV2Core, type V2Core } from "../db/v2-core";
import { createV2OfficialSourceRepository } from "../db/v2-official-sources";
import { paidHoldRequestSchema } from "../modules/budget/contracts";
import {
  createGatewayExecutionPlanner,
  executionDescriptorSchema,
  type TokenBounds,
} from "../modules/budget/execution-plan";
import {
  createGatewayBudgetService,
  type GatewayExecutionBinding,
} from "../modules/budget/gateway-ledger";
import { hasCurrentConsent } from "../modules/consent/service";
import { GUIDE_HOSTS } from "../modules/legal-retrieval/v2/registry";
import { createV2LegalRetrieval } from "../modules/legal-retrieval/v2/service";
import {
  isWorkspacePublicQuery,
  workspaceRetrievalPlans,
} from "../modules/legal-retrieval/v2/workspace-plans";
import type { GatewayAttemptRequest } from "../modules/llm-gateway/attempts";
import { MODEL_ID, type Phase } from "../modules/llm-gateway/prompts";
import {
  createLlmGateway,
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../modules/llm-gateway/service";
import { readWorkspaceContext } from "../modules/workspace/context";
import { createWorkspaceDispatcher } from "../modules/workspace/dispatch";
import { executeWorkspace, type WorkspaceParams } from "../modules/workspace/execution";
import { createWorkspacePipeline } from "../modules/workspace/pipeline";
import type { WorkspaceDependencies } from "../modules/workspace/service";
import { readProcessingProofs } from "./processing-proofs";

/** Role changes revoke future dispatch/publication without erasing paid receipts. */
export async function hasCustomerWorkspaceAccess(core: V2Core, ownerId: string) {
  return (
    (await readAccountType(core.binding, ownerId)) === "customer" &&
    (await hasCurrentConsent(drizzle(core.binding, { schema }), ownerId))
  );
}

const boundsConfigSchema = z.strictObject({
  bounds: executionDescriptorSchema.omit({
    model: true,
    phase: true,
    correction: true,
    wireInputSha256: true,
    inputBytes: true,
    outputTokenUpperBound: true,
  }),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: z.string().datetime(),
});
/** Only a deployment-owned setting can supply authenticated model capability bounds. */
function configuredBounds(env: Env) {
  try {
    return boundsConfigSchema.parse(JSON.parse(env.AI_MODEL_TOKEN_BOUNDS_JSON ?? "null"));
  } catch {
    return null;
  }
}
const phaseFor = (kind: string): Phase =>
  kind === "intake_questions"
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
  const wire = prepareGatewayWireInput(phase, input);
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
    input: async () => input,
    bounds: async (wire) => {
      if (!config) return null;
      if (config.bounds.basis !== "verified_model_context_limit")
        return config.bounds as TokenBounds;
      // A complete context reservation includes this exact output cap. No text/token heuristic.
      const inputLimit = config.bounds.modelContextTokenLimit - wire.max_completion_tokens;
      if (
        inputLimit <= 0 ||
        inputLimit > config.bounds.modelInputTokenLimit ||
        config.bounds.vision
      )
        return null;
      return {
        ...config.bounds,
        textTokensUpperBound: inputLimit,
        framingTokensUpperBound: 0,
        modelInputTokenLimit: inputLimit,
      } as TokenBounds;
    },
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
      if (!env.WORKSPACE_PROCESSING || !env.AI || !configuredBounds(env)) return null;
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
            }
          : undefined);
      const context = await readWorkspaceContext(
        core,
        { ownerId: input.ownerId, now },
        input.caseId,
        latest,
        GUIDE_HOSTS,
      );
      const invocationId = crypto.randomUUID(),
        phase = phaseFor(input.kind),
        r = await request(phase, context, invocationId, input.jobId);
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
      const prepared = await budget(core, env, input.ownerId, context).prepareAdmission(binding, r);
      return prepared ? { paid: prepared.paid, actor: prepared.actor } : null;
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
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  return executeWorkspace(core, params, instanceId, {
    guideHosts: GUIDE_HOSTS,
    authorize: (ownerId) => hasCustomerWorkspaceAccess(core, ownerId),
    pipeline: async (job, lease) => {
      const row = await core
        .statement(
          "SELECT h.attempt_id,p.payload_json,c.allocation_proof_id FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_cost_attempts a ON a.id=h.attempt_id JOIN v2_runtime_controls c ON c.month=a.month AND c.environment=? WHERE h.job_id=? AND h.state='prepared' AND p.target_revision=? AND p.deadline_at>? ORDER BY h.attempt_id LIMIT 1",
          [
            env.APP_ENV === "production" ? "production" : "preview",
            job.id,
            params.workspaceRevision,
            new Date().toISOString(),
          ],
        )
        .first<{ attempt_id: string; payload_json: string; allocation_proof_id: string }>();
      if (!row) throw new Error("Paid admission unavailable");
      const original = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
      const primary = phaseFor(job.kind);
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
          if (!(await hasCustomerWorkspaceAccess(core, params.ownerId)))
            throw new Error("Customer access unavailable");
          const currentId = invocationId ?? invocation(phase),
            now = new Date().toISOString();
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
          if (useInitial && !initial) throw new Error("Admission unavailable");
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
          return createLlmGateway(env, { attemptLedger: ledger }).call(
            phase,
            input,
            requestId,
            reserve,
            reserveCorrection,
            currentId,
          );
        },
      };
      return createWorkspacePipeline(gateway, {
        reserve: async () => hasCustomerWorkspaceAccess(core, params.ownerId),
        invocation,
        retrieve: async (context, requests) => {
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
          return {
            ...context,
            citations: output.chunks.map((chunk) => chunk.citation),
            sourceTexts: output.chunks.map((chunk) => ({
              citationId: chunk.citation.id,
              text: chunk.span.text,
            })),
            sourceStatus: output.legalSourceStatus,
            references: {
              ...context.references,
              verifiedCitationIds: output.chunks.map((chunk) => chunk.citation.id),
            },
          };
        },
      });
    },
  });
}
