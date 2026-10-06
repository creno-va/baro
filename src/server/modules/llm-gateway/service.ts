import { z } from "zod";
import {
  guidanceResultSchema,
  minimizedInputSchema,
  questionOutputSchema,
  screeningOutputSchema,
  structuredCaseSchema,
  validationOutputSchema,
} from "../../../contracts";
import {
  type GatewayAttemptHandle,
  type GatewayAttemptLedger,
  type GatewayTransportReceipt,
  invocationIdSchema,
  providerStatus,
  responseReceipt,
  unavailableReceipt,
} from "./attempts";
import { MODEL_ID, type Phase, PROMPT_VERSION, prompts } from "./prompts";

const schemas = {
  minimize: minimizedInputSchema,
  screening: screeningOutputSchema,
  structure: structuredCaseSchema,
  questions: questionOutputSchema,
  generation: guidanceResultSchema,
  validation: validationOutputSchema,
};
const limits = {
  minimize: 2200,
  screening: 800,
  structure: 4000,
  questions: 1800,
  generation: 8000,
  validation: 8000,
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
    options: { gateway: { id: string; collectLog: false; skipCache: true } },
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
function wireSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(wireSchema);
  if (schema && typeof schema === "object") {
    const input = schema as Record<string, unknown>;
    if ("not" in input && Object.keys(input).length === 1) return { type: "string" }; // Empty text-question options remain maxItems=0.
    return Object.fromEntries(
      Object.entries(input)
        .filter(([key]) => key !== "$schema")
        .map(([key, value]) => [key, wireSchema(value)]),
    );
  }
  return schema;
}
export function createLlmGateway(
  env: { AI: GatewayBinding; AI_GATEWAY_ID: string; APP_ENV?: string },
  options: {
    sleep?: (ms: number) => Promise<void>;
    observe?: (metric: ModelMetric) => void;
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
      const jsonSchema = wireSchema(
        z.toJSONSchema(envelope, { io: "input", unrepresentable: "any" }),
      );
      let correction = false;
      for (let call = 0; call < 3; call++) {
        const wireInput = {
          messages: [
            { role: "system", content: `BARO prompt ${PROMPT_VERSION}. ${prompts[phase]}` },
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
          reasoning_effort: "medium",
          max_completion_tokens: limits[phase],
          store: false,
          service_tier: "default",
          response_format: {
            type: "json_schema",
            json_schema: { name: `baro_${phase}_v1`, strict: true, schema: jsonSchema },
          },
        };
        let handle: GatewayAttemptHandle | null = null;
        const record = async (receipt: GatewayTransportReceipt) => {
          if (!ledger || !handle) return;
          try {
            await ledger.afterTransport(handle, receipt);
          } catch {
            // Persistence failures must neither publish output nor retry a paid call.
            throw new ModelError("MODEL_UNAVAILABLE");
          }
        };
        if (ledger) {
          try {
            const wireBytes = new TextEncoder().encode(JSON.stringify(wireInput));
            const digest = await crypto.subtle.digest("SHA-256", wireBytes);
            handle = await ledger.beforeDispatch({
              invocationId: invocationId as string,
              requestId,
              phase,
              model: MODEL_ID,
              attemptOrdinal: call + 1,
              correction,
              inputBytes: wireBytes.byteLength,
              wireInputSha256: Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join(""),
              outputTokenUpperBound: limits[phase],
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
            ? env.AI.run(MODEL_ID, wireInput, {
                gateway: { id: env.AI_GATEWAY_ID, collectLog: false, skipCache: true },
              })
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
        if (raw && typeof raw === "object" && "error" in raw)
          throw new ModelError("MODEL_UNAVAILABLE");
        const completion = z
          .object({
            choices: z
              .array(
                z.object({
                  message: z.object({
                    content: z.string().nullable(),
                    refusal: z.string().nullable().optional(),
                  }),
                  finish_reason: z.string(),
                }),
              )
              .min(1)
              .max(1),
            usage: z
              .object({
                prompt_tokens: z.number().int().nonnegative(),
                completion_tokens: z.number().int().nonnegative(),
              })
              .optional(),
          })
          .safeParse(raw);
        let output: unknown = null;
        if (completion.success && completion.data.choices[0]?.message.refusal)
          throw new ModelError("POLICY_REJECTED");
        if (completion.success && completion.data.choices[0]?.finish_reason === "stop") {
          try {
            const content = completion.data.choices[0].message.content ?? "";
            if (content.length <= 256 * 1024) output = envelope.parse(JSON.parse(content)).output;
          } catch {
            output = null;
          }
        }
        if (output !== null) {
          options.observe?.({
            requestId,
            phase,
            model: MODEL_ID,
            latencyMs: Date.now() - start,
            inputTokens: completion.success ? (completion.data.usage?.prompt_tokens ?? null) : null,
            outputTokens: completion.success
              ? (completion.data.usage?.completion_tokens ?? null)
              : null,
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
