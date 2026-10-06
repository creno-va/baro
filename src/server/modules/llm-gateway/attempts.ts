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

/** Extract metering independently of choices/refusal/content/schema validity. */
export function responseReceipt(raw: unknown): GatewayTransportReceipt {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const usage =
    value?.usage && typeof value.usage === "object"
      ? (value.usage as Record<string, unknown>)
      : null;
  return {
    transport: "response",
    providerRequestId:
      typeof value?.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) ? value.id : null,
    inputTokens: tokenCount(usage?.prompt_tokens),
    outputTokens: tokenCount(usage?.completion_tokens),
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
