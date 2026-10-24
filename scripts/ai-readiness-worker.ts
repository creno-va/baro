import { DurableObject } from "cloudflare:workers";
import type { z } from "zod";
import { MODEL_ID } from "../src/server/model-policy";
import { lookupCatalog } from "../src/server/modules/external-tools/catalog";
import { createExternalTools } from "../src/server/modules/external-tools/service";
import { ProcessingError } from "../src/server/modules/file-processing/protocol";
import { responseReceipt } from "../src/server/modules/llm-gateway/attempts";
import {
  createLlmGateway,
  type GatewayBinding,
  ModelError,
} from "../src/server/modules/llm-gateway/service";
import { createMediaGateway } from "../src/server/modules/llm-gateway/transcription";
import { documentedVisionSupport } from "../src/server/modules/llm-gateway/vision-wire";
import {
  createWorkspacePipeline,
  WorkspaceOutputPolicyError,
} from "../src/server/modules/workspace/pipeline";
import type { ProbeOutcome } from "./ai-readiness-control";
import {
  activeProvenance,
  authorizedProbeRequest,
  handleDurableProbe,
  PROBE_PROTOCOL_VERSION,
  PROBE_REQUEST_ID,
  type ProbeConfiguration,
  probePolicyFailureSchema,
  probeProviderFailureSchema,
} from "./ai-readiness-control";
import {
  syntheticChatContext,
  syntheticIntakeContext,
  syntheticSummaryContext,
  syntheticToolContext,
} from "./ai-readiness-fixture";

interface ProbeEnv extends ProbeConfiguration {
  AI: GatewayBinding;
  AI_GATEWAY_ID: string;
  PROBE: DurableObjectNamespace;
  PROBE_FIXTURES: Fetcher;
  READINESS_IMAGE_SHA256: string;
  READINESS_AUDIO_SHA256: string;
}

// An isolated synthetic-only Worker. No application DB, cases or OAuth credentials.
export class SyntheticProbe extends DurableObject<ProbeEnv> {
  override async fetch(request: Request): Promise<Response> {
    return handleDurableProbe(request, this.env, this.ctx.storage, async (reserve) => {
      const metrics: ProbeOutcome["metrics"] = [];
      const providerFailures: z.infer<typeof probeProviderFailureSchema>[] = [];
      const mediaChecks: NonNullable<ProbeOutcome["mediaChecks"]> = [];
      try {
        const active = activeProvenance(this.env);
        if (!active) throw new ModelError("MODEL_UNAVAILABLE");
        if (active.featureCase === "media") {
          let meter: { inputTokens: number | null; outputTokens: number | null } = {
            inputTokens: null,
            outputTokens: null,
          };
          const media = createMediaGateway(this.env, {
            costs: {
              before: async () =>
                (await reserve()) ? { attemptId: crypto.randomUUID(), dispatchToken: null } : null,
              after: async (_permit, receipt) => {
                if (receipt.transport === "response") {
                  const observed = responseReceipt(receipt.rawUsage);
                  meter = {
                    inputTokens: observed.inputTokens,
                    outputTokens: observed.outputTokens,
                  };
                }
              },
            },
            waitUntil: (task) => this.ctx.waitUntil(task),
            visionCapability: async () => documentedVisionSupport(),
            observeFailure: (failure) => {
              const safe = probeProviderFailureSchema.safeParse(failure);
              if (safe.success) providerFailures.push(safe.data);
            },
          });
          const access = { authorize: async () => true, signal: new AbortController().signal };
          for (const phase of ["vision", "asr"] as const) {
            meter = { inputTokens: null, outputTokens: null };
            const response = await this.env.PROBE_FIXTURES.fetch(
              `https://synthetic.invalid/${phase === "vision" ? "image-markers.jpg" : "speech-ko.wav"}`,
            );
            if (!response.ok) throw new ModelError("MODEL_UNAVAILABLE");
            const bytes = new Uint8Array(await response.arrayBuffer());
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            if (
              hash !==
              (phase === "vision"
                ? this.env.READINESS_IMAGE_SHA256
                : this.env.READINESS_AUDIO_SHA256)
            )
              throw new ModelError("MODEL_UNAVAILABLE");
            const started = Date.now();
            let matched = false;
            try {
              if (phase === "vision") {
                const output = await media.observe(bytes, access);
                const text = output.texts.join(" ");
                matched = /GREEN\s*TRIANGLE|초록|녹색/i.test(text) && /09|아홉/.test(text);
                mediaChecks.push({
                  phase,
                  quality: output.quality,
                  markerMatched: matched,
                  segmentCount: null,
                });
              } else {
                const output = await media.transcribe(bytes, 0, 7.15, access);
                const text = output.text.replace(/\s|[.,]/g, "");
                matched =
                  /파란상자/.test(text) &&
                  /열일곱|17|십칠/.test(text) &&
                  /삼각형/.test(text) &&
                  /아홉|9/.test(text);
                mediaChecks.push({
                  phase,
                  quality: output.status,
                  markerMatched: matched,
                  segmentCount: output.segments.length,
                });
              }
              metrics.push({
                requestId: PROBE_REQUEST_ID,
                phase,
                model: phase === "vision" ? MODEL_ID : "@cf/openai/whisper-large-v3-turbo",
                latencyMs: Date.now() - started,
                ...meter,
                status: "success",
              });
            } catch (error) {
              metrics.push({
                requestId: PROBE_REQUEST_ID,
                phase,
                model: phase === "vision" ? MODEL_ID : "@cf/openai/whisper-large-v3-turbo",
                latencyMs: Date.now() - started,
                ...meter,
                status: "failed",
              });
              throw error;
            }
            if (!matched) throw new ModelError("POLICY_REJECTED");
          }
          return { status: "passed", failure: null, metrics, providerFailures, mediaChecks };
        }
        const gateway = createLlmGateway(this.env, {
          observe: (m) => metrics.push(m),
          observeFailure: (failure) => {
            const safe = probeProviderFailureSchema.safeParse(failure);
            if (safe.success) providerFailures.push(safe.data);
          },
        });
        const pipeline = createWorkspacePipeline(gateway, {
          reserve: async () => reserve(),
          invocation: () => crypto.randomUUID(),
          lookup: async (tools) => {
            const external = createExternalTools(
              {},
              {
                fetch: async () => {
                  throw new Error("SYNTHETIC_EXTERNAL_NETWORK_FORBIDDEN");
                },
              },
            );
            return Promise.all(
              tools.map((tool) =>
                external.execute(tool, null, {
                  authorize: async () => true,
                  reserve: async () => false,
                  signal: new AbortController().signal,
                }),
              ),
            );
          },
        });
        if (
          active.featureCase === "tools_business" ||
          active.featureCase === "tools_property" ||
          active.featureCase === "tools_registry"
        ) {
          const context = syntheticToolContext(active.featureCase);
          context.lookupTools = lookupCatalog({});
          const output = await pipeline.chat(context, PROBE_REQUEST_ID);
          const expected = {
            tools_business: ["hometax_status", "thecheat"],
            tools_property: ["datahub_property", "datahub_building"],
            tools_registry: ["registry"],
          }[active.featureCase];
          const valid =
            output.toolResults.length === expected.length &&
            expected.every((tool) =>
              output.toolResults.some(
                (result) =>
                  result.tool === tool &&
                  result.status === "not_configured" &&
                  result.observedAt === null &&
                  result.rows.length === 0,
              ),
            );
          return {
            status: valid ? "passed" : "failed",
            failure: valid ? null : "POLICY_REJECTED",
            metrics,
            providerFailures,
          };
        }
        const valid =
          active.featureCase === "workspace_questions"
            ? (await pipeline.questions(syntheticIntakeContext(), PROBE_REQUEST_ID)).length >= 1
            : active.featureCase === "workspace_summary"
              ? !!(await pipeline.summary(syntheticSummaryContext(), PROBE_REQUEST_ID)).overview
              : !!(await pipeline.chat(syntheticChatContext(), PROBE_REQUEST_ID)).text;
        return valid
          ? { status: "passed", failure: null, metrics, providerFailures }
          : { status: "failed", failure: "POLICY_REJECTED", metrics, providerFailures };
      } catch (error) {
        const policy =
          error instanceof WorkspaceOutputPolicyError
            ? probePolicyFailureSchema.safeParse({
                reason: error.reason,
                ...(error.factFailure ? { factCategory: error.factFailure.category } : {}),
                ...(error.auditFailure
                  ? {
                      auditCodes: error.auditFailure.findings.map(({ severity, code }) => ({
                        severity,
                        code,
                      })),
                    }
                  : {}),
              })
            : null;
        return {
          status: "failed",
          failure:
            error instanceof ModelError
              ? error.code
              : error instanceof ProcessingError && error.code === "MODEL_SCHEMA_INVALID"
                ? "MODEL_SCHEMA_INVALID"
                : error instanceof ProcessingError && error.code === "POLICY_REJECTED"
                  ? "POLICY_REJECTED"
                  : "MODEL_UNAVAILABLE",
          metrics,
          providerFailures,
          ...(mediaChecks.length ? { mediaChecks } : {}),
          ...(policy?.success ? { policyFailure: policy.data } : {}),
        };
      }
    });
  }
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const forwarded = authorizedProbeRequest(request, env);
    const active = activeProvenance(env);
    if (!forwarded || !active)
      return Response.json(
        {
          status: "unavailable",
          probeVersion: PROBE_PROTOCOL_VERSION,
          configurationReady: Boolean(env.READINESS_TOKEN) && active !== null,
        },
        { status: 403 },
      );
    let transportStage = "binding";
    try {
      // Stable per candidate, never a source-hash namespace that resets its call budget.
      const stub = env.PROBE.get(
        env.PROBE.idFromName(`${active.candidateSha}:${active.featureCase}`),
      );
      transportStage = "dispatch";
      return await stub.fetch(forwarded);
    } catch {
      return Response.json({ status: "probe-transport-failed", transportStage }, { status: 502 });
    }
  },
};
