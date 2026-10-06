import { createCaseDataCipher } from "../crypto";
import { createGatewayExecutionPlanner } from "../modules/budget/execution-plan";
import { MODEL_ID } from "../modules/llm-gateway/prompts";
import { gatewayWireIdentity, prepareGatewayWireInput } from "../modules/llm-gateway/service";
import { configuredBounds, workspaceTokenBounds } from "./workspace";

const phases = [
  "workspace_questions",
  "workspace_summary",
  "workspace_chat",
  "workspace_audit",
] as const;
type Reservation = {
  phase: (typeof phases)[number];
  inputTokens: number;
  outputTokens: number;
};
export type AiConfiguration = {
  status: "ready" | "not_ready";
  environment: string;
  release: string;
  reservations: Reservation[];
};

/** Inspect Worker-owned settings without invoking any provider, Workflow or DB.
 * Only public model capacity counts leave this boundary, never evidence or secrets.
 */
export async function inspectAiConfiguration(
  env: Env | undefined,
  now = new Date().toISOString(),
): Promise<AiConfiguration> {
  const unavailable: AiConfiguration = {
    status: "not_ready",
    environment: env?.APP_ENV ?? "test",
    release: env?.RELEASE_SHA ?? "local",
    reservations: [],
  };
  try {
    if (
      !env ||
      typeof env.AI?.run !== "function" ||
      typeof env.WORKSPACE_PROCESSING?.create !== "function" ||
      typeof env.WORKSPACE_PROCESSING?.get !== "function" ||
      typeof env.ANALYSIS_ACCOUNT_LIMIT?.limit !== "function" ||
      typeof env.CASE_ACCOUNT_LIMIT?.limit !== "function" ||
      typeof env.CASE_IP_LIMIT?.limit !== "function" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(env.AI_GATEWAY_ID ?? "")
    )
      return unavailable;
    // Import the Worker-owned key using the same parser as workspace requests.
    // This checks configuration only; no customer data is read or encrypted.
    await createCaseDataCipher(env);
    const config = configuredBounds(env);
    if (
      !config ||
      !Number.isFinite(Date.parse(now)) ||
      Date.parse(config.bounds.validUntil) <= Date.parse(now) + 300_000
    )
      return unavailable;
    const planner = createGatewayExecutionPlanner({
      input: async () => ({}),
      bounds: async (wire) => workspaceTokenBounds(config, wire.max_completion_tokens),
      verifyBounds: async (_descriptor, digest) => ({
        digest,
        evidenceHash: config.evidenceHash,
        verifiedAt: config.verifiedAt,
      }),
    });
    const reservations: Reservation[] = [];
    for (const phase of phases) {
      const wire = prepareGatewayWireInput(phase, {});
      const execution = await planner.verify(
        {
          invocationId: "configuration-inspection",
          requestId: "configuration-inspection",
          phase,
          model: MODEL_ID,
          attemptOrdinal: 1,
          correction: false,
          ...(await gatewayWireIdentity(wire)),
          outputTokenUpperBound: wire.max_completion_tokens,
        },
        now,
      );
      if (!execution) return unavailable;
      const inputTokens = Number(
        execution.quantities.find((item) => item.sku === "model_input_tokens")?.maximumQuantity,
      );
      const outputTokens = Number(
        execution.quantities.find((item) => item.sku === "model_output_tokens")?.maximumQuantity,
      );
      if (
        !Number.isSafeInteger(inputTokens) ||
        !Number.isSafeInteger(outputTokens) ||
        inputTokens < 1 ||
        outputTokens < 1
      )
        return unavailable;
      reservations.push({ phase, inputTokens, outputTokens });
    }
    return { ...unavailable, status: "ready", reservations };
  } catch {
    return unavailable;
  }
}
