import { DurableObject } from "cloudflare:workers";
import type { z } from "zod";
import { MODEL_ID } from "../src/server/model-policy";
import { lookupCatalog } from "../src/server/modules/external-tools/catalog";
import { createExternalTools } from "../src/server/modules/external-tools/service";
import { ProcessingError } from "../src/server/modules/file-processing/protocol";
import { researchExcerpt } from "../src/server/modules/legal-retrieval/research/topics";
import { responseReceipt } from "../src/server/modules/llm-gateway/attempts";
import {
  createLlmGateway,
  type GatewayBinding,
  ModelError,
  WORKSPACE_MODEL_TIMEOUT_MS,
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
  syntheticComparisonContext,
  syntheticIntakeContext,
  syntheticLegalContext,
  syntheticSummaryContext,
  syntheticToolContext,
} from "./ai-readiness-fixture";
import { createSyntheticLegalLookup } from "./ai-readiness-legal";
import { createSyntheticMaterialLookup } from "./ai-readiness-materials";

interface ProbeEnv extends ProbeConfiguration {
  AI: GatewayBinding;
  AI_GATEWAY_ID: string;
  PROBE: DurableObjectNamespace;
  PROBE_FIXTURES: Fetcher;
  READINESS_IMAGE_SHA256: string;
  READINESS_AUDIO_SHA256: string;
  LAW_API_OC?: string;
  READINESS_VIDEO_ORANGE_SHA256?: string;
  READINESS_VIDEO_GREEN_SHA256?: string;
  READINESS_VIDEO_AUDIO_SHA256?: string;
}

// An isolated synthetic-only Worker. No application DB, cases or OAuth credentials.
export class SyntheticProbe extends DurableObject<ProbeEnv> {
  override async fetch(request: Request): Promise<Response> {
    return handleDurableProbe(request, this.env, this.ctx.storage, async (reserve) => {
      const metrics: ProbeOutcome["metrics"] = [];
      const providerFailures: z.infer<typeof probeProviderFailureSchema>[] = [];
      const mediaChecks: NonNullable<ProbeOutcome["mediaChecks"]> = [];
      let legal: ReturnType<typeof createSyntheticLegalLookup> | null = null;
      let material: ReturnType<typeof createSyntheticMaterialLookup> | null = null;
      let comparisonSource: NonNullable<ProbeOutcome["comparisonChecks"]>["source"] = null;
      try {
        const active = activeProvenance(this.env);
        if (!active) throw new ModelError("MODEL_UNAVAILABLE");
        if (active.featureCase === "material_chat") material = createSyntheticMaterialLookup();
        if (active.featureCase === "legal_chat" || active.featureCase === "precedent_compare") {
          if (!this.env.LAW_API_OC?.trim()) throw new ModelError("MODEL_UNAVAILABLE");
          legal = createSyntheticLegalLookup(this.env.LAW_API_OC, undefined, active.featureCase);
        }
        if (active.featureCase === "media" || active.featureCase === "video_media") {
          const video = active.featureCase === "video_media";
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
          const samples = video
            ? [
                {
                  phase: "vision" as const,
                  name: "video-orange.jpg",
                  hash: this.env.READINESS_VIDEO_ORANGE_SHA256,
                  videoFrame: { timestampSeconds: 1.4, frameIndex: 14 },
                },
                {
                  phase: "vision" as const,
                  name: "video-green.jpg",
                  hash: this.env.READINESS_VIDEO_GREEN_SHA256,
                  videoFrame: { timestampSeconds: 3.2, frameIndex: 32 },
                },
                {
                  phase: "asr" as const,
                  name: "video-speech.wav",
                  hash: this.env.READINESS_VIDEO_AUDIO_SHA256,
                  videoFrame: undefined,
                },
              ]
            : [
                {
                  phase: "vision" as const,
                  name: "image-markers.jpg",
                  hash: this.env.READINESS_IMAGE_SHA256,
                  videoFrame: undefined,
                },
                {
                  phase: "asr" as const,
                  name: "speech-ko.wav",
                  hash: this.env.READINESS_AUDIO_SHA256,
                  videoFrame: undefined,
                },
              ];
          for (const sample of samples) {
            const { phase } = sample;
            meter = { inputTokens: null, outputTokens: null };
            const response = await this.env.PROBE_FIXTURES.fetch(
              `https://synthetic.invalid/${sample.name}`,
            );
            if (!response.ok) throw new ModelError("MODEL_UNAVAILABLE");
            const bytes = new Uint8Array(await response.arrayBuffer());
            const hash = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            if (hash !== sample.hash) throw new ModelError("MODEL_UNAVAILABLE");
            const started = Date.now();
            let matched = false;
            try {
              if (phase === "vision") {
                const output = await media.observe(
                  bytes,
                  access,
                  undefined,
                  video ? "video_frame" : "image",
                );
                const text = output.texts.join(" ");
                matched = video
                  ? sample.videoFrame?.frameIndex === 14
                    ? /ORANGE|주황|오렌지/i.test(text) &&
                      /CIRCLE|원|동그라미/i.test(text) &&
                      /42|마흔두|사십이/i.test(text)
                    : /GREEN|초록|녹색/i.test(text) &&
                      /TRIANGLE|삼각형/i.test(text) &&
                      /09|9|아홉/i.test(text)
                  : /GREEN\s*TRIANGLE|초록|녹색/i.test(text) && /09|아홉/.test(text);
                mediaChecks.push({
                  phase,
                  quality: output.quality,
                  markerMatched: matched,
                  segmentCount: null,
                  ...(sample.videoFrame ? { videoFrame: sample.videoFrame } : {}),
                });
              } else {
                const output = await media.transcribe(bytes, 0, video ? 8 : 7.15, access);
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
          timeoutMs: WORKSPACE_MODEL_TIMEOUT_MS,
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
          ...(legal ? { retrieve: legal.retrieve } : {}),
          ...(material ? { readMaterials: material.readMaterials } : {}),
        });
        if (active.featureCase === "precedent_compare" && legal) {
          const context = await legal.retrieve(syntheticComparisonContext(), [
            { kind: "precedent", concept: "대여금" },
          ]);
          const chunk = context.sourceRetrieval?.chunks.find(
            (chunk) => chunk.citation.kind === "precedent",
          );
          if (chunk?.citation.kind !== "precedent") throw new ModelError("POLICY_REJECTED");
          context.precedentComparison = {
            basedOnWorkspaceRevision: 1,
            summaryRevision: 1,
            source: {
              citation: chunk.citation,
              excerpt: researchExcerpt(chunk.source.body, [], 4000),
            },
          };
          const excerpt = context.precedentComparison.source.excerpt;
          comparisonSource = {
            officialId: chunk.citation.officialId,
            contentHash: chunk.citation.contentHash,
            verifiedAt: chunk.citation.verifiedAt,
            excerptStartUtf16: excerpt.startUtf16,
            excerptEndUtf16: excerpt.endUtf16,
            fullLengthUtf16: excerpt.fullLengthUtf16,
            truncated: excerpt.truncated,
          };
          const output = await pipeline.chat(context, PROBE_REQUEST_ID);
          const result = "precedentComparison" in output ? output.precedentComparison : null;
          const source = legal.snapshot(0);
          const comparisonChecks = {
            requests: source.requests,
            verifiedSourceCount: source.verifiedSourceCount,
            sourceFailures: source.sourceFailures,
            metricCount: result?.metrics.length ?? null,
            matchedCount: result?.matchedCount ?? null,
            knownCount: result?.knownCount ?? null,
            percentage: result?.percentage ?? null,
            source: comparisonSource,
          };
          const valid =
            !!result &&
            result.metrics.length === 8 &&
            result.knownCount > 0 &&
            source.verifiedSourceCount > 0 &&
            source.sourceFailures.length === 0;
          return {
            status: valid ? "passed" : "failed",
            failure: valid ? null : "POLICY_REJECTED",
            metrics,
            providerFailures,
            comparisonChecks,
          };
        }
        if (active.featureCase === "material_chat" && material) {
          const output = await pipeline.chat(material.context, PROBE_REQUEST_ID);
          const materialChecks = material.snapshot(output);
          const valid =
            materialChecks.readRequests > 0 &&
            materialChecks.lastPageRead &&
            materialChecks.answerMatched &&
            materialChecks.sourcePositionMatched;
          return {
            status: valid ? "passed" : "failed",
            failure: valid ? null : "POLICY_REJECTED",
            metrics,
            providerFailures,
            materialChecks,
          };
        }
        if (active.featureCase === "legal_chat" && legal) {
          const output = await pipeline.chat(syntheticLegalContext(), PROBE_REQUEST_ID);
          const legalChecks = legal.snapshot(
            output.sourceClaims.filter((c) => c.kind === "quotation").length,
          );
          const valid =
            legalChecks.requests > 0 &&
            legalChecks.verifiedSourceCount > 0 &&
            legalChecks.acceptedQuotationCount > 0 &&
            legalChecks.sourceFailures.length === 0;
          return {
            status: valid ? "passed" : "failed",
            failure: valid ? null : "POLICY_REJECTED",
            metrics,
            providerFailures,
            legalChecks,
          };
        }
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
          ...(legal && this.env.READINESS_FEATURE_CASE === "legal_chat"
            ? { legalChecks: legal.snapshot(0) }
            : {}),
          ...(legal && this.env.READINESS_FEATURE_CASE === "precedent_compare"
            ? {
                comparisonChecks: {
                  source: comparisonSource,
                  requests: legal.snapshot(0).requests,
                  verifiedSourceCount: legal.snapshot(0).verifiedSourceCount,
                  sourceFailures: legal.snapshot(0).sourceFailures,
                  metricCount: null,
                  matchedCount: null,
                  knownCount: null,
                  percentage: null,
                },
              }
            : {}),
          ...(material ? { materialChecks: material.snapshot() } : {}),
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
