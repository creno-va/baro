import type { MODEL_ID, Phase } from "./prompts";

export interface GatewayAttemptRequest {
  invocationId: string;
  requestId: string;
  phase: Phase;
  model: typeof MODEL_ID;
  attemptOrdinal: number;
  correction: boolean;
  /** Complete serialized wire input, not an assertion about tokenizer output. */
  inputBytes: number;
  /** Server-computed identity of the complete binding input. Private plan evidence,
   * never public telemetry and never evidence of a tokenizer/vision upper bound.
   */
  wireInputSha256: string;
  outputTokenUpperBound: number;
}

export interface GatewayAttemptHandle {
  invocationId: string;
  attemptId: string;
}

export interface GatewayTransportReceipt {
  transport: "response" | "provider_error" | "unknown" | "not_sent";
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  serviceTier: "default" | "flex" | "scale" | "priority" | null;
  /** Structural completeness only; the trusted sink still verifies the pricing basis. */
  meteringStatus: "complete" | "incomplete" | "invalid";
  observedAt: string;
  /** A local unsent candidate. The trusted sink must CAS-check prepared/reserved
   * with no dispatch token before confirming it or releasing shared exposure.
   * A replay must never cancel another worker's dispatched attempt.
   */
  definitiveNoCharge: boolean;
}

/** Trusted server closures bind the handle to the durable job/revision/lease/plan.
 * No request-body adapter may supply this ledger. Absent price/funding proof denies
 * the hold; missing usage retains exposure rather than inventing a zero charge.
 */
export interface GatewayAttemptLedger {
  beforeDispatch(request: GatewayAttemptRequest): Promise<GatewayAttemptHandle | null>;
  confirmDispatch(handle: GatewayAttemptHandle): Promise<boolean>;
  afterTransport(handle: GatewayAttemptHandle, receipt: GatewayTransportReceipt): Promise<void>;
  waitUntil(settlement: Promise<void>): void;
}

export const invocationIdSchema =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extract metering independently of choices/refusal/content/schema validity. */
export function responseReceipt(raw: unknown): GatewayTransportReceipt {
  const value = object(raw);
  const usage = object(value?.usage);
  const details = object(usage?.prompt_tokens_details);
  const counts = [
    usage?.prompt_tokens,
    usage?.completion_tokens,
    details?.cached_tokens,
    details?.cache_write_tokens,
  ];
  const [inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens] =
    counts.map(tokenCount);
  const tier = value?.service_tier;
  const serviceTier =
    tier === "default" || tier === "flex" || tier === "scale" || tier === "priority" ? tier : null;
  const malformed =
    (value?.usage != null && usage === null) ||
    (usage?.prompt_tokens_details != null && details === null) ||
    counts.some((count) => count != null && tokenCount(count) === null) ||
    (tier != null && serviceTier === null) ||
    (inputTokens != null &&
      BigInt(cachedInputTokens ?? 0) + BigInt(cacheWriteInputTokens ?? 0) > BigInt(inputTokens));
  return {
    transport: "response",
    providerRequestId:
      typeof value?.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) ? value.id : null,
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    cachedInputTokens: cachedInputTokens ?? null,
    cacheWriteInputTokens: cacheWriteInputTokens ?? null,
    serviceTier,
    meteringStatus: malformed
      ? "invalid"
      : counts.every((count) => tokenCount(count) !== null) && serviceTier !== null
        ? "complete"
        : "incomplete",
    observedAt: new Date().toISOString(),
    definitiveNoCharge: false,
  };
}

export function unavailableReceipt(
  transport: "provider_error" | "unknown" | "not_sent",
): GatewayTransportReceipt {
  return {
    transport,
    providerRequestId: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    serviceTier: null,
    meteringStatus: "incomplete",
    observedAt: new Date().toISOString(),
    definitiveNoCharge: transport === "not_sent",
  };
}

export function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const value = error.status;
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : null;
}
