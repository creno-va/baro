import { z } from "zod";
import { timestampSchema } from "../../../contracts";
import { v2HashSchema } from "../../../contracts/v2";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import type { GatewayAttemptRequest } from "../llm-gateway/attempts";
import { MODEL_ID } from "../llm-gateway/prompts";
import { gatewayWireIdentity, prepareGatewayWireInput } from "../llm-gateway/service";
import type { ExecutionPlan } from "./contracts";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCount = count.refine((n) => n > 0);
export const executionDescriptorSchema = z.strictObject({
  model: z.literal(MODEL_ID),
  phase: z.enum([
    "minimize",
    "screening",
    "structure",
    "questions",
    "generation",
    "validation",
    "workspace_questions",
    "workspace_summary",
    "workspace_chat",
    "workspace_audit",
  ]),
  correction: z.boolean(),
  wireInputSha256: v2HashSchema,
  inputBytes: positiveCount,
  outputTokenUpperBound: positiveCount,
  basis: z.enum(["verified_tokenizer_and_framing", "verified_model_context_limit"]),
  tokenizerRevision: z.string().min(1).max(100),
  textTokensUpperBound: count,
  framingTokensUpperBound: count,
  vision: z
    .strictObject({
      imageCount: positiveCount,
      maximumTokens: positiveCount,
      capabilityEvidenceHash: v2HashSchema,
      dimensionsAndDetailHash: v2HashSchema,
    })
    .nullable(),
  modelInputTokenLimit: positiveCount,
  modelContextTokenLimit: positiveCount,
  modelOutputTokenLimit: positiveCount,
  checkedAt: timestampSchema,
  validUntil: timestampSchema,
});
export type ExecutionDescriptor = z.infer<typeof executionDescriptorSchema>;
export type TokenBounds = Omit<
  ExecutionDescriptor,
  "model" | "phase" | "correction" | "wireInputSha256" | "inputBytes" | "outputTokenUpperBound"
>;
export type VerifiedExecution = {
  readonly descriptor: ExecutionDescriptor;
  readonly quantities: ExecutionPlan["quantities"];
  readonly evidenceHash: string;
  readonly verifiedAt: string;
};
const verified = new WeakSet<object>();
export const isVerifiedExecution = (value: unknown): value is VerifiedExecution =>
  value !== null && typeof value === "object" && verified.has(value);

/** Concrete producer/consumer connection. Immutable job input and authenticated
 * bounds come from server closures; identity/cap always come from the one shared
 * Gateway builder. Bound provenance is verified over the complete descriptor.
 */
export function createGatewayExecutionPlanner(options: {
  input: (request: GatewayAttemptRequest) => Promise<unknown>;
  bounds: (
    wire: ReturnType<typeof prepareGatewayWireInput>,
    now: string,
  ) => Promise<TokenBounds | null>;
  verifyBounds?: Parameters<typeof createExecutionPlanner>[0]["verifyBounds"];
}) {
  return createExecutionPlanner({
    ...(options.verifyBounds ? { verifyBounds: options.verifyBounds } : {}),
    async expected(request, now) {
      const wire = prepareGatewayWireInput(
        request.phase,
        await options.input(request),
        request.correction,
      );
      const bounds = await options.bounds(wire, now);
      if (!bounds) return null;
      return {
        ...bounds,
        model: MODEL_ID,
        phase: request.phase,
        correction: request.correction,
        ...(await gatewayWireIdentity(wire)),
        outputTokenUpperBound: wire.max_completion_tokens,
      };
    },
  });
}

/** The closure derives metadata from the server's exact shared wire builder and
 * authenticates the model/tokenizer/vision bounds. No byte/token heuristic or
 * client boolean can provide this evidence. Missing closure denies execution.
 */
export function createExecutionPlanner(options: {
  expected: (request: GatewayAttemptRequest, now: string) => Promise<unknown>;
  verifyBounds?: (
    descriptor: ExecutionDescriptor,
    digest: string,
    now: string,
  ) => Promise<{ digest: string; evidenceHash: string; verifiedAt: string } | null>;
}) {
  return {
    async verify(request: GatewayAttemptRequest, now: string): Promise<VerifiedExecution | null> {
      if (!options.verifyBounds) return null;
      const parsed = executionDescriptorSchema.safeParse(await options.expected(request, now));
      if (!parsed.success) return null;
      const d = parsed.data;
      const input =
        BigInt(d.textTokensUpperBound) +
        BigInt(d.framingTokensUpperBound) +
        BigInt(d.vision?.maximumTokens ?? 0);
      if (
        request.model !== d.model ||
        request.phase !== d.phase ||
        request.correction !== d.correction ||
        request.wireInputSha256 !== d.wireInputSha256 ||
        request.inputBytes !== d.inputBytes ||
        request.outputTokenUpperBound !== d.outputTokenUpperBound ||
        input <= 0n ||
        input > BigInt(d.modelInputTokenLimit) ||
        input + BigInt(d.outputTokenUpperBound) > BigInt(d.modelContextTokenLimit) ||
        d.outputTokenUpperBound > d.modelOutputTokenLimit ||
        (d.basis === "verified_model_context_limit" && input !== BigInt(d.modelInputTokenLimit)) ||
        Date.parse(d.checkedAt) > Date.parse(now) ||
        Date.parse(d.validUntil) <= Date.parse(now)
      )
        return null;
      Object.freeze(d.vision);
      Object.freeze(d);
      const digest = await runtimeDigest(d);
      const proof = await options.verifyBounds(d, digest, now);
      if (
        !proof ||
        proof.digest !== digest ||
        !v2HashSchema.safeParse(proof.evidenceHash).success ||
        !timestampSchema.safeParse(proof.verifiedAt).success ||
        Date.parse(proof.verifiedAt) > Date.parse(now) ||
        Date.parse(proof.verifiedAt) >= Date.parse(d.validUntil)
      )
        return null;
      const quantities: ExecutionPlan["quantities"] = [
        { sku: "model_input_tokens", maximumQuantity: input.toString() },
        { sku: "model_output_tokens", maximumQuantity: String(d.outputTokenUpperBound) },
      ];
      const result = {
        descriptor: d,
        quantities,
        evidenceHash: await runtimeDigest({
          descriptorDigest: digest,
          boundsEvidenceHash: proof.evidenceHash,
        }),
        verifiedAt: new Date(proof.verifiedAt).toISOString(),
      };
      Object.freeze(d.vision);
      Object.freeze(d);
      for (const item of quantities) Object.freeze(item);
      Object.freeze(quantities);
      Object.freeze(result);
      verified.add(result);
      return result;
    },
  };
}
