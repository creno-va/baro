import type { V2Core } from "../db/v2-core";
import { createV2JobsRepository } from "../db/v2-jobs";
import type { JobLease } from "../db/v2-workspace";
import { reportProviderFailure } from "../dependency-diagnostics";
import { paidHoldRequestSchema } from "../modules/budget/contracts";
import { createGatewayExecutionPlanner, type TokenBounds } from "../modules/budget/execution-plan";
import type { GatewayExecutionBinding } from "../modules/budget/gateway-ledger";
import { createGatewayBudgetService } from "../modules/budget/gateway-ledger";
import { configuredBounds } from "../modules/budget/model-configuration";
import type { GatewayAttemptRequest } from "../modules/llm-gateway/attempts";
import { MODEL_ID, type Phase } from "../modules/llm-gateway/prompts";
import {
  createLlmGateway,
  gatewayWireIdentity,
  ModelError,
  prepareGatewayWireInput,
  WORKSPACE_MODEL_TIMEOUT_MS,
} from "../modules/llm-gateway/service";
import { workspaceModelInput } from "../modules/workspace/pipeline";

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
export async function gatewayAttemptRequest(
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
export function createWorkspaceGatewayBudget(
  core: V2Core,
  env: Env,
  ownerId: string,
  input: unknown,
  clock?: () => string,
) {
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
    ...(clock ? { clock } : {}),
    execution: planner.verify,
  });
}

/** Read the original immutable admission without refreshing its wire or day. */
export async function readWorkspaceGatewayAdmission(
  core: V2Core,
  env: Env,
  jobId: string,
  revision: number,
  now: string,
) {
  const row = await core
    .statement(
      "SELECT h.attempt_id,p.payload_json,p.created_at,c.allocation_proof_id FROM v2_execution_job_holds h JOIN v2_execution_job_plans p ON p.id=h.plan_id JOIN v2_execution_attempts a ON a.id=h.attempt_id LEFT JOIN v2_runtime_controls c ON c.month=a.month AND c.environment=? WHERE h.job_id=? AND h.state='prepared' AND p.target_revision=? AND p.deadline_at>? ORDER BY h.attempt_id LIMIT 1",
      [env.APP_ENV === "production" ? "production" : "preview", jobId, revision, now],
    )
    .first<{
      attempt_id: string;
      payload_json: string;
      created_at: string;
      allocation_proof_id: string | null;
    }>();
  return row
    ? { ...row, original: paidHoldRequestSchema.parse(JSON.parse(row.payload_json)) }
    : null;
}
/** Every separately paid generation/correction/audit still uses the existing
 * ledger. A live worker lease never substitutes for the initial admission. */
export function createLeasedWorkspaceGateway(
  core: V2Core,
  env: Env,
  options: {
    ownerId: string;
    caseId: string;
    revision: number;
    jobId: string;
    operationId: string;
    lease: JobLease;
    primary: Phase;
    admission: NonNullable<Awaited<ReturnType<typeof readWorkspaceGatewayAdmission>>>;
    authorize(): Promise<boolean>;
    waitUntil(work: Promise<void>): void;
    clock?: () => string;
    onPhase?: (phase: Phase) => Promise<void>;
  },
): ReturnType<typeof createLlmGateway> {
  const clock = options.clock ?? (() => new Date().toISOString());
  const { original } = options.admission;
  if (
    original.jobId !== options.jobId ||
    original.targetId !== options.caseId ||
    original.targetRevision !== options.revision ||
    original.plan.operationId !== options.operationId
  )
    throw new ModelError("MODEL_UNAVAILABLE");
  let initialUsed = false;
  return {
    async call(phase, input, requestId, reserve, reserveCorrection, invocationId) {
      // The complete native wire and its admission must use the same public
      // projection. Full binding originals stay in server-side proof storage.
      input = workspaceModelInput(input);
      if (!invocationId || !(await options.authorize())) throw new ModelError("MODEL_UNAVAILABLE");
      await options.onPhase?.(phase);
      const now = clock(),
        actor = { ownerId: options.ownerId, now };
      if (
        !(await createV2JobsRepository(core).renew(
          actor,
          options.lease,
          new Date(Date.parse(now) + 300000).toISOString(),
        ))
      )
        throw new ModelError("MODEL_UNAVAILABLE");
      const useInitial = !initialUsed;
      if (useInitial && (phase !== options.primary || invocationId !== original.plan.invocationId))
        throw new ModelError("MODEL_UNAVAILABLE");
      const binding: GatewayExecutionBinding = {
        operationId: options.operationId,
        operationRevision: original.plan.operationRevision,
        requestHash: original.plan.requestHash,
        jobId: options.jobId,
        targetKind: "workspace",
        targetId: options.caseId,
        targetRevision: options.revision,
        invocationId,
        maximumAttempts: 3,
        deadlineAt: useInitial
          ? original.plan.deadlineAt
          : new Date(Date.parse(now) + 300000).toISOString(),
        pricingProofId: original.pricingProofId,
        fundingProofId: original.fundingProofId,
        allocationProofId: options.admission.allocation_proof_id,
      };
      const budget = createWorkspaceGatewayBudget(core, env, options.ownerId, input, clock);
      const initial = useInitial
        ? await budget.restoreAdmission(
            binding,
            await gatewayAttemptRequest(phase, input, invocationId, requestId),
            options.admission.attempt_id,
          )
        : null;
      if (useInitial && !initial) throw new ModelError("MODEL_UNAVAILABLE");
      initialUsed = true;
      const ledger = budget.createLedger({
        binding,
        ...(initial ? { initial } : {}),
        waitUntil: options.waitUntil,
        lease: async () => {
          const row = await core
            .statement(
              "SELECT lease_until FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=? AND status IN ('running','validating')",
              [options.jobId, options.lease.token, options.lease.fencing],
            )
            .first<{ lease_until: string }>();
          if (!row || !(await options.authorize())) throw new ModelError("MODEL_UNAVAILABLE");
          return { lease: options.lease, expiresAt: row.lease_until };
        },
      });
      return createLlmGateway(env, {
        attemptLedger: ledger,
        observeFailure: reportProviderFailure,
        timeoutMs: WORKSPACE_MODEL_TIMEOUT_MS,
      }).call(phase, input, requestId, reserve, reserveCorrection, invocationId);
    },
  };
}
