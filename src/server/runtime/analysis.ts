import { reportProviderFailure } from "../dependency-diagnostics";
import { createLegacyAnalysisLedger } from "../modules/budget/legacy-analysis-ledger";
import { createAnalysisExecution, type ExecutionPhase } from "../modules/case-structure/execution";
import { domainRepository } from "../modules/intake/service";
import { createLegalRetrieval } from "../modules/legal-retrieval/service";
import type { GatewayAttemptRequest } from "../modules/llm-gateway/attempts";
import { createLlmGateway } from "../modules/llm-gateway/service";

export const LEGACY_ANALYSIS_PHASES: ExecutionPhase[] = [
  "initialize",
  "minimize",
  "screening",
  "structure",
  "questions",
  "retrieval",
  "generation",
  "validation",
  "finish",
];

/** Composition shared with the actual Workflow, so compatibility tests cannot
 * accidentally omit preview/production execution requirements. */
export async function createLegacyAnalysisRuntime(
  env: Env,
  params: { analysisId: string; inputRevision: number },
  instanceId: string,
  options: {
    waitUntil(work: Promise<void>): void;
    retrieval?: ReturnType<typeof createLegalRetrieval>;
    timeoutMs?: number;
  },
) {
  const repo = await domainRepository(env);
  const inputs = new Map<string, unknown>();
  const ledger = await createLegacyAnalysisLedger({
    env,
    params,
    instanceId,
    waitUntil: options.waitUntil,
    async input(request: GatewayAttemptRequest) {
      if (!inputs.has(request.invocationId)) throw new Error("LEGACY_INPUT_UNAVAILABLE");
      return inputs.get(request.invocationId);
    },
  });
  const gateway = createLlmGateway(env, {
    observeFailure: (failure) => {
      try {
        reportProviderFailure(failure);
      } catch {
        /* Diagnostics never replace transport receipts. */
      }
    },
    attemptLedger: ledger,
    requireAttemptLedger: true,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return createAnalysisExecution(
    env,
    params,
    instanceId,
    {
      async call(phase, input, requestId, reserve, reserveCorrection) {
        const invocationId = crypto.randomUUID();
        inputs.set(invocationId, input);
        try {
          return await gateway.call(
            phase,
            input,
            requestId,
            reserve,
            reserveCorrection,
            invocationId,
          );
        } finally {
          inputs.delete(invocationId);
        }
      },
    },
    options.retrieval ?? createLegalRetrieval(env, repo),
  );
}
