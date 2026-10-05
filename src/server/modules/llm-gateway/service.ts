import { z } from "zod";
import {
  guidanceResultSchema,
  minimizedInputSchema,
  questionOutputSchema,
  screeningOutputSchema,
  structuredCaseSchema,
  validationOutputSchema,
} from "../../../contracts";
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
  env: { AI: GatewayBinding; AI_GATEWAY_ID: string },
  options: {
    sleep?: (ms: number) => Promise<void>;
    observe?: (metric: ModelMetric) => void;
    timeoutMs?: number;
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
    ): Promise<unknown> {
      if (!env.AI || !env.AI_GATEWAY_ID || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new ModelError("MODEL_UNAVAILABLE");
      const schema = schemas[phase];
      const envelope = z.strictObject({ output: schema });
      const jsonSchema = wireSchema(
        z.toJSONSchema(envelope, { io: "input", unrepresentable: "any" }),
      );
      let correction = false;
      for (let call = 0; call < 3; call++) {
        if (!(await reserve())) throw new ModelError("MODEL_UNAVAILABLE");
        const start = Date.now();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let raw: unknown;
        try {
          // Binding has no abort parameter. A timeout ends this phase; no immediate retry
          // can overlap an ambiguous provider call. Durable reservation survives replay.
          raw = await Promise.race([
            env.AI.run(
              MODEL_ID,
              {
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
                response_format: {
                  type: "json_schema",
                  json_schema: { name: `baro_${phase}_v1`, strict: true, schema: jsonSchema },
                },
              },
              { gateway: { id: env.AI_GATEWAY_ID, collectLog: false, skipCache: true } },
            ),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new ModelError("MODEL_UNAVAILABLE")),
                options.timeoutMs ?? 60_000,
              );
            }),
          ]);
        } catch (error) {
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
          const status =
            typeof error === "object" && error !== null && "status" in error
              ? Number(error.status)
              : null;
          if (status !== null && status !== 429 && status < 500)
            throw new ModelError("MODEL_UNAVAILABLE");
          if (call === 2) throw new ModelError("MODEL_UNAVAILABLE");
          const retryAfter =
            typeof error === "object" && error !== null && "retryAfter" in error
              ? Number(error.retryAfter)
              : 0;
          await sleep(
            Math.max(
              1000 * 2 ** call + Math.floor(Math.random() * 200),
              Math.min(30_000, Math.max(0, retryAfter) * 1000),
            ),
          );
          continue;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
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
