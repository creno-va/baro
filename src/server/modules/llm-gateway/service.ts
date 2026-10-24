import { z } from "zod";
import {
  guidanceResultSchema,
  minimizedInputSchema,
  questionOutputSchema,
  screeningOutputSchema,
  structuredCaseSchema,
  validationOutputSchema,
} from "../../../contracts";
import { type DependencyCategory, dependencyCategory } from "../../dependency-diagnostics";
import {
  type GatewayAttemptHandle,
  type GatewayAttemptLedger,
  type GatewayTransportReceipt,
  invocationIdSchema,
  providerStatus,
  responseReceipt,
  unavailableReceipt,
} from "./attempts";
import { readModelCompletion } from "./completion";
import { MODEL_ID, type Phase, PROMPT_VERSION, prompts, WORKSPACE_PROMPT_VERSION } from "./prompts";
import { providerWire } from "./provider-wire";
import { gatewayRequestIssue, gatewayResponse } from "./transport";
import {
  workspaceAuditOutputSchema,
  workspaceChatOutputSchema,
  workspaceQuestionsOutputSchema,
  workspaceSummaryOutputSchema,
} from "./v2/schemas";

const schemas = {
  minimize: minimizedInputSchema,
  screening: screeningOutputSchema,
  structure: structuredCaseSchema,
  // Previously saved v1 batches of up to five remain readable. New generation
  // uses the current three-question batch ceiling, without changing that DTO.
  questions: questionOutputSchema.extend({
    questions: questionOutputSchema.shape.questions.max(3),
  }),
  generation: guidanceResultSchema,
  validation: validationOutputSchema,
  workspace_questions: workspaceQuestionsOutputSchema,
  workspace_summary: workspaceSummaryOutputSchema,
  workspace_chat: workspaceChatOutputSchema,
  workspace_audit: workspaceAuditOutputSchema,
};
const limits = {
  minimize: 2200,
  screening: 800,
  structure: 4000,
  questions: 1800,
  generation: 8000,
  validation: 8000,
  workspace_questions: 2400,
  workspace_summary: 10000,
  workspace_chat: 10000,
  workspace_audit: 2400,
};
export class ModelError extends Error {
  constructor(readonly code: "MODEL_UNAVAILABLE" | "MODEL_SCHEMA_INVALID" | "POLICY_REJECTED") {
    super(code);
  }
}
export interface GatewayBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options: {
      gateway: { id: string; collectLog: false; skipCache: true };
      returnRawResponse?: true;
    },
  ): Promise<unknown>;
}
export interface ModelMetric {
  requestId: string;
  phase: Phase;
  model: typeof MODEL_ID;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  status: "success" | "failed";
}
/** Existing workspace phase limit, shared with its isolated acceptance harness.
 * Legacy callers retain the gateway's separate 60-second default. */
export const WORKSPACE_MODEL_TIMEOUT_MS = 120_000;
function wireSchema(schema: unknown, compactNumbers = false): unknown {
  if (Array.isArray(schema)) return schema.map((value) => wireSchema(value, compactNumbers));
  if (schema && typeof schema === "object") {
    const input = schema as Record<string, unknown>;
    if ("not" in input && Object.keys(input).length === 1) return { type: "string" }; // Empty text-question options remain maxItems=0.
    return Object.fromEntries(
      Object.entries(input)
        // Defaults are server parsing annotations, not generation constraints.
        // Gemini accepts a JSON Schema subset; keep required/defaulted fields
        // mandatory while omitting this non-validation annotation on the wire.
        // Positive maxItems expands nested constrained-decoding states (audit
        // has 30 findings/300 IDs; chat has nested unions). Keep these unchanged
        // in server Zod and enforce the same output-token caps, without sending
        // array-count grammar expansion. maxItems=0 still forbids text options.
        .filter(
          ([key, value]) =>
            key !== "$schema" &&
            key !== "default" &&
            // Chat repeats large revision/UTF-16/frame bounds inside unions.
            // Gemini's numeric grammar can reject these before inference.
            // Keep integers/types here and all range checks in server Zod.
            !(
              compactNumbers &&
              ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"].includes(
                key,
              )
            ) &&
            !(key === "maxItems" && typeof value === "number" && value > 0),
        )
        // Zod discriminated unions emit oneOf; the provider supports anyOf.
        // Server-side Zod parsing still enforces the original exact union.
        .map(([key, value]) =>
          key === "const"
            ? ["enum", [value]]
            : [key === "oneOf" ? "anyOf" : key, wireSchema(value, compactNumbers)],
        ),
    );
  }
  return schema;
}
/** Private provider input shared by dispatch and the trusted paid-execution planner. */
export function prepareGatewayWireInput(phase: Phase, input: unknown, correction = false) {
  const envelope = z.strictObject({ output: schemas[phase] });
  // Strict provider output must include defaulted fields too; input schemas mark
  // them optional, which the provider rejects before generating a response.
  const jsonSchema = wireSchema(
    z.toJSONSchema(envelope, {
      io: "output",
      unrepresentable: "any",
      // Chat and retained structure repeat closed facts/references in several arrays.
      // Reuse definitions instead of duplicating their nested unions on the wire.
      ...(phase === "workspace_chat" || phase === "structure" ? { reused: "ref" as const } : {}),
    }),
    phase === "workspace_chat",
  );
  return {
    messages: [
      {
        role: "system",
        content: `BARO prompt ${phase.startsWith("workspace_") ? WORKSPACE_PROMPT_VERSION : PROMPT_VERSION}. ${prompts[phase]}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          data: input,
          correction: correction
            ? "Previous output did not match schema. Return exactly the schema without new facts."
            : null,
        }),
      },
    ],
    ...(phase === "workspace_audit" || phase === "validation"
      ? {
          extra_body: {
            google: { thinking_config: { thinking_level: "medium", include_thoughts: false } },
          },
        }
      : { reasoning_effort: "low" as const }),
    max_completion_tokens: limits[phase],
    service_tier: "default",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `baro_${phase}_${phase.startsWith("workspace_") ? "v2" : "v1"}`,
        strict: true,
        schema: jsonSchema,
      },
    },
  };
}

/** Identity only: neither byte length nor this digest proves a token/vision cost bound. */
export async function gatewayWireIdentity(wireInput: ReturnType<typeof prepareGatewayWireInput>) {
  return gatewayTransportIdentity(providerWire(wireInput));
}
/** Identity for an already-built transport, including offline captured replays. */
export async function gatewayTransportIdentity(input: Record<string, unknown>) {
  const wireBytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", wireBytes);
  return {
    inputBytes: wireBytes.byteLength,
    wireInputSha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

export function createLlmGateway(
  env: { AI: GatewayBinding; AI_GATEWAY_ID: string; APP_ENV?: string },
  options: {
    sleep?: (ms: number) => Promise<void>;
    observe?: (metric: ModelMetric) => void;
    observeFailure?: (failure: {
      phase: Phase;
      category: DependencyCategory;
      httpStatus: number | null;
      requestIssue?: ReturnType<typeof gatewayRequestIssue>;
    }) => void;
    timeoutMs?: number;
    attemptLedger?: GatewayAttemptLedger;
    requireAttemptLedger?: boolean;
  } = {},
) {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async call(
      phase: Phase,
      input: unknown,
      requestId: string,
      reserve: () => Promise<boolean>,
      reserveCorrection: () => Promise<boolean> = async () => true,
      invocationId?: string,
    ): Promise<unknown> {
      if (!env.AI || !env.AI_GATEWAY_ID || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new ModelError("MODEL_UNAVAILABLE");
      const ledger = options.attemptLedger;
      if (
        !ledger &&
        (options.requireAttemptLedger || env.APP_ENV === "preview" || env.APP_ENV === "production")
      )
        throw new ModelError("MODEL_UNAVAILABLE");
      if (ledger && (!invocationId || !invocationIdSchema.test(invocationId)))
        throw new ModelError("MODEL_UNAVAILABLE");
      const schema = schemas[phase];
      const envelope = z.strictObject({ output: schema });
      let correction = false;
      for (let call = 0; call < 3; call++) {
        const wireInput = prepareGatewayWireInput(phase, input, correction);
        let handle: GatewayAttemptHandle | null = null;
        const record = async (receipt: GatewayTransportReceipt) => {
          if (!ledger || !handle) return;
          try {
            await ledger.afterTransport(handle, receipt);
          } catch {
            // Unhandled ledger/integrity failures must not publish or retry.
            // The concrete ledger isolates observation-only accounting outages.
            throw new ModelError("MODEL_UNAVAILABLE");
          }
        };
        if (ledger) {
          try {
            const wireIdentity = await gatewayWireIdentity(wireInput);
            handle = await ledger.beforeDispatch({
              invocationId: invocationId as string,
              requestId,
              phase,
              model: MODEL_ID,
              attemptOrdinal: call + 1,
              correction,
              ...wireIdentity,
              outputTokenUpperBound: wireInput.max_completion_tokens,
            });
          } catch {
            throw new ModelError("MODEL_UNAVAILABLE");
          }
          if (
            !handle ||
            handle.invocationId !== invocationId ||
            !invocationIdSchema.test(handle.attemptId)
          )
            throw new ModelError("MODEL_UNAVAILABLE");
        }
        const start = Date.now();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        let didDispatch = false;
        let finishTimeoutRecord = () => {};
        const timeoutRecorded = new Promise<void>((resolve) => {
          finishTimeoutRecord = resolve;
        });
        let startRemote: (allowed: boolean) => void = () => {};
        // Register the settlement lifetime before the final dispatch commit. A local
        // context failure must not start paid work or lose its eventual usage receipt.
        const remote = new Promise<boolean>((resolve) => {
          startRemote = resolve;
        }).then((allowed) =>
          allowed
            ? env.AI.run(MODEL_ID, providerWire(wireInput), {
                gateway: { id: env.AI_GATEWAY_ID, collectLog: false, skipCache: true },
                returnRawResponse: true,
              }).then(gatewayResponse)
            : undefined,
        );
        if (ledger) {
          try {
            ledger.waitUntil(
              remote
                .then(
                  async (response) => {
                    if (!didDispatch || !timedOut) return;
                    await timeoutRecorded;
                    await record(responseReceipt(response));
                  },
                  async (error: unknown) => {
                    if (!didDispatch || !timedOut) return;
                    await timeoutRecorded;
                    await record(
                      unavailableReceipt(
                        providerStatus(error) === null ? "unknown" : "provider_error",
                      ),
                    );
                  },
                )
                .catch(() => {
                  throw new ModelError("MODEL_UNAVAILABLE");
                }),
            );
          } catch {
            startRemote(false);
            await record(unavailableReceipt("not_sent"));
            throw new ModelError("MODEL_UNAVAILABLE");
          }
        }
        let admitted = false;
        try {
          admitted = await reserve();
          if (admitted && ledger && handle) admitted = await ledger.confirmDispatch(handle);
        } catch {
          admitted = false;
        }
        if (!admitted) {
          startRemote(false);
          await record(unavailableReceipt("not_sent"));
          throw new ModelError("MODEL_UNAVAILABLE");
        }
        didDispatch = true;
        startRemote(true);
        let raw: unknown;
        try {
          // Binding has no abort parameter. A timeout ends this phase; no immediate retry
          // can overlap an ambiguous provider call. Durable reservation survives replay.
          raw = await Promise.race([
            remote,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                timedOut = true;
                reject(new ModelError("MODEL_UNAVAILABLE"));
              }, options.timeoutMs ?? 60_000);
            }),
          ]);
        } catch (error) {
          const status = providerStatus(error);
          options.observeFailure?.({
            phase,
            category: timedOut ? "provider_timeout" : dependencyCategory(error),
            httpStatus: status,
            ...(gatewayRequestIssue(error) ? { requestIssue: gatewayRequestIssue(error) } : {}),
          });
          try {
            await record(unavailableReceipt(status === null ? "unknown" : "provider_error"));
          } finally {
            finishTimeoutRecord();
          }
          options.observe?.({
            requestId,
            phase,
            model: MODEL_ID,
            latencyMs: Date.now() - start,
            inputTokens: null,
            outputTokens: null,
            status: "failed",
          });
          if (error instanceof ModelError) throw error;
          if (status === null) throw new ModelError("MODEL_UNAVAILABLE");
          if (status !== null && status !== 429 && status < 500)
            throw new ModelError("MODEL_UNAVAILABLE");
          if (call === 2) throw new ModelError("MODEL_UNAVAILABLE");
          const retryAfterValue =
            typeof error === "object" && error !== null && "retryAfter" in error
              ? Number(error.retryAfter)
              : 0;
          const retryAfter = Number.isFinite(retryAfterValue) ? retryAfterValue : 0;
          await sleep(
            Math.max(
              1000 * 2 ** call + Math.floor(Math.random() * 200),
              Math.min(30_000, Math.max(0, retryAfter) * 1000),
            ),
          );
          continue;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          finishTimeoutRecord();
        }
        await record(responseReceipt(raw));
        if (raw && typeof raw === "object" && "error" in raw) {
          options.observeFailure?.({
            phase,
            category: dependencyCategory(raw.error),
            httpStatus: providerStatus(raw.error),
          });
          throw new ModelError("MODEL_UNAVAILABLE");
        }
        const completion = readModelCompletion(raw);
        let output: unknown = null;
        if (completion?.refused) throw new ModelError("POLICY_REJECTED");
        if (completion?.stopped) {
          try {
            const content = completion.content ?? "";
            if (content.length <= 256 * 1024) output = envelope.parse(JSON.parse(content)).output;
          } catch {
            output = null;
          }
        }
        if (output !== null) {
          const usage = responseReceipt(raw);
          options.observe?.({
            requestId,
            phase,
            model: MODEL_ID,
            latencyMs: Date.now() - start,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            status: "success",
          });
          return output;
        }
        if (correction || call === 2) throw new ModelError("MODEL_SCHEMA_INVALID");
        if (!(await reserveCorrection())) throw new ModelError("MODEL_SCHEMA_INVALID");
        correction = true;
      }
      throw new ModelError("MODEL_UNAVAILABLE");
    },
  };
}
