import { z } from "zod";
import { MODEL_ID } from "../src/server/model-policy";
import { comparisonEvidenceObservationSchema } from "../src/server/modules/legal-retrieval/research/comparison";
import {
  type ModelMetric,
  WORKSPACE_MODEL_TIMEOUT_MS,
} from "../src/server/modules/llm-gateway/service";
import { workspaceAuditFindingSchema } from "../src/server/modules/llm-gateway/v2/schemas";

export const PROBE_PROTOCOL_VERSION = 3 as const;
export const featureCaseSchema = z.enum([
  "workspace_questions",
  "workspace_summary",
  "workspace_chat",
  "media",
  "tools_business",
  "tools_property",
  "tools_registry",
  "legal_chat",
  "video_media",
  "material_chat",
  "precedent_compare",
]);
/** Outer observation deadline accommodates existing phase limits without
 * creating a second POST or extending the application's execution limits. */
export function probePostTimeoutMs(feature: z.infer<typeof featureCaseSchema>) {
  const phase =
    feature === "media" || feature === "video_media" ? 60_000 : WORKSPACE_MODEL_TIMEOUT_MS;
  return 3 * phase + (["legal_chat", "precedent_compare"].includes(feature) ? 120_000 : 0) + 10_000;
}
export const PROBE_REQUEST_ID = "00000000-0000-4000-8000-000000000027" as const;
const candidateSchema = z.string().regex(/^[a-f0-9]{40}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const provenanceSchema = z.strictObject({
  featureCase: featureCaseSchema,
  candidateSha: candidateSchema,
  probeSourceSha256: hashSchema,
});
export type ProbeProvenance = z.infer<typeof provenanceSchema>;
export interface ProbeConfiguration {
  READINESS_FEATURE_CASE?: string | undefined;
  READINESS_CANDIDATE_SHA?: string | undefined;
  READINESS_PROBE_SHA256?: string | undefined;
  READINESS_TOKEN?: string | undefined;
}
export const runtimeFailureSchema = z.strictObject({
  stage: z.enum(["read-state", "acquire", "model", "write-report"]),
  category: z.enum(["type-error", "probe-runtime-error"]),
});
const probePhaseSchema = z.enum([
  "screening",
  "workspace_questions",
  "workspace_summary",
  "workspace_chat",
  "workspace_precedent_compare",
  "workspace_audit",
  "vision",
  "asr",
]);
export const probeProviderFailureSchema = z.strictObject({
  phase: probePhaseSchema,
  requestIssue: z
    .enum([
      "thinking_configuration",
      "thinking_output_limit",
      "unsupported_parameter",
      "schema_complexity",
      "schema_constraint",
    ])
    .optional(),
  category: z.enum([
    "provider_schema",
    "provider_model",
    "provider_auth",
    "provider_budget",
    "provider_rate",
    "provider_timeout",
    "provider_request",
    "provider_unavailable",
    "unknown",
  ]),
  httpStatus: z.number().int().min(400).max(599).nullable(),
});
export const probePolicyFailureSchema = z.strictObject({
  reason: z.enum([
    "unauthorized_reference",
    "unsupported_fact",
    "prohibited_content",
    "question_repetition",
    "audit_rejected",
  ]),
  factCategory: z
    .enum([
      "source_text_unavailable",
      "source_text_mismatch",
      "claim_text_missing",
      "claim_reference_mismatch",
    ])
    .optional(),
  auditCodes: z
    .array(workspaceAuditFindingSchema.pick({ severity: true, code: true }))
    .max(30)
    .optional(),
});
const unverified = [
  "full-product-smoke",
  "live-corpus-eval",
  "oauth",
  "legal",
  "public-policy",
] as const;
const mediaChecksSchema = z
  .array(
    z.strictObject({
      phase: z.enum(["vision", "asr"]),
      quality: z.enum(["processed", "low_quality"]),
      markerMatched: z.boolean(),
      segmentCount: z.number().int().min(0).max(1000).nullable(),
      videoFrame: z
        .strictObject({
          timestampSeconds: z.number().min(0).max(8),
          frameIndex: z.number().int().min(0).max(79),
        })
        .optional(),
    }),
  )
  .max(3);
const legalChecksSchema = z.strictObject({
  requests: z.number().int().min(0).max(9),
  verifiedSourceCount: z.number().int().min(0).max(10),
  acceptedQuotationCount: z.number().int().min(0).max(50),
  sourceFailures: z.array(z.enum(["upstream_rejected", "schema_mismatch", "unavailable"])).max(2),
});
const materialChecksSchema = z.strictObject({
  readRequests: z.number().int().min(0).max(2),
  observationsRead: z.number().int().min(0).max(64),
  lastPageRead: z.boolean(),
  answerMatched: z.boolean(),
  sourcePositionMatched: z.boolean(),
});
const comparisonChecksSchema = z.strictObject({
  requests: z.number().int().min(0).max(9),
  verifiedSourceCount: z.number().int().min(0).max(10),
  metricCount: z.number().int().min(0).max(8).nullable(),
  matchedCount: z.number().int().min(0).max(8).nullable(),
  knownCount: z.number().int().min(0).max(8).nullable(),
  percentage: z.number().int().min(0).max(100).nullable(),
  source: z
    .strictObject({
      officialId: z.string().regex(/^\d{1,20}$/),
      contentHash: hashSchema,
      verifiedAt: z.iso.datetime(),
      excerptStartUtf16: z.number().int().nonnegative(),
      excerptEndUtf16: z.number().int().positive(),
      fullLengthUtf16: z.number().int().positive(),
      truncated: z.boolean(),
    })
    .refine(
      (source) =>
        source.excerptStartUtf16 < source.excerptEndUtf16 &&
        source.excerptEndUtf16 <= source.fullLengthUtf16 &&
        source.truncated ===
          (source.excerptStartUtf16 > 0 || source.excerptEndUtf16 < source.fullLengthUtf16),
    )
    .nullable(),
  sourceFailures: legalChecksSchema.shape.sourceFailures,
});
const reportSchema = z
  .strictObject({
    version: z.literal(PROBE_PROTOCOL_VERSION),
    checkedAt: z.iso.datetime(),
    candidateSha: candidateSchema,
    featureCase: featureCaseSchema,
    probeSourceSha256: hashSchema,
    environment: z.literal("isolated-synthetic-worker"),
    status: z.enum(["passed", "failed"]),
    failure: z.enum(["MODEL_UNAVAILABLE", "MODEL_SCHEMA_INVALID", "POLICY_REJECTED"]).nullable(),
    runtimeWorker: z.literal(true),
    attempts: z.number().int().min(0).max(3),
    metricCoverage: z.enum(["complete", "partial"]),
    metrics: z
      .array(
        z.strictObject({
          requestId: z.literal(PROBE_REQUEST_ID),
          phase: probePhaseSchema,
          model: z.enum([MODEL_ID, "@cf/openai/whisper-large-v3-turbo"]),
          latencyMs: z.number().finite().min(0),
          inputTokens: z.number().int().min(0).nullable(),
          outputTokens: z.number().int().min(0).nullable(),
          status: z.enum(["success", "failed"]),
        }),
      )
      .max(3),
    providerFailures: z.array(probeProviderFailureSchema).max(3).optional(),
    mediaChecks: mediaChecksSchema.optional(),
    policyFailure: probePolicyFailureSchema.optional(),
    legalChecks: legalChecksSchema.optional(),
    materialChecks: materialChecksSchema.optional(),
    comparisonChecks: comparisonChecksSchema.optional(),
    comparisonEvidence: z.array(comparisonEvidenceObservationSchema).max(3).optional(),
    unverified: z.tuple(
      unverified.map((value) => z.literal(value)) as [
        z.ZodLiteral<"full-product-smoke">,
        z.ZodLiteral<"live-corpus-eval">,
        z.ZodLiteral<"oauth">,
        z.ZodLiteral<"legal">,
        z.ZodLiteral<"public-policy">,
      ],
    ),
  })
  .refine(
    (report) =>
      report.metrics.length <= report.attempts &&
      report.metrics.every(
        (metric) =>
          (metric.phase === "asr") === (metric.model === "@cf/openai/whisper-large-v3-turbo") &&
          (report.featureCase === "media" || report.featureCase === "video_media"
            ? ["asr", "vision"].includes(metric.phase)
            : !["asr", "vision"].includes(metric.phase)),
      ) &&
      report.metricCoverage ===
        (report.metrics.length === report.attempts ? "complete" : "partial") &&
      (report.featureCase === "legal_chat" || report.legalChecks === undefined) &&
      (report.featureCase === "material_chat" || report.materialChecks === undefined) &&
      (report.featureCase === "precedent_compare" || report.comparisonChecks === undefined) &&
      (report.featureCase === "precedent_compare" || report.comparisonEvidence === undefined) &&
      (report.featureCase === "video_media" ||
        report.mediaChecks?.every((check) => check.videoFrame === undefined) !== false) &&
      (report.status === "passed"
        ? report.failure === null &&
          report.attempts > 0 &&
          report.metrics.at(-1)?.status === "success" &&
          (report.featureCase !== "precedent_compare" ||
            (report.comparisonChecks !== undefined &&
              report.comparisonChecks.requests > 0 &&
              report.comparisonChecks.verifiedSourceCount > 0 &&
              report.comparisonChecks.sourceFailures.length === 0 &&
              report.comparisonChecks.metricCount === 8 &&
              report.comparisonEvidence?.at(-1)?.reason === "accepted" &&
              report.comparisonChecks.source !== null &&
              Date.parse(report.comparisonChecks.source.verifiedAt) <=
                Date.parse(report.checkedAt) &&
              report.comparisonChecks.matchedCount !== null &&
              report.comparisonChecks.knownCount !== null &&
              report.comparisonChecks.knownCount > 0 &&
              report.comparisonChecks.knownCount >= report.comparisonChecks.matchedCount &&
              report.comparisonChecks.percentage ===
                Math.round((100 * report.comparisonChecks.matchedCount) / 8) &&
              report.metrics.some(
                (metric) =>
                  metric.phase === "workspace_precedent_compare" && metric.status === "success",
              ) &&
              report.metrics.at(-1)?.phase === "workspace_audit")) &&
          (report.featureCase !== "material_chat" ||
            (report.materialChecks !== undefined &&
              report.materialChecks.readRequests > 0 &&
              report.materialChecks.observationsRead > 0 &&
              report.materialChecks.lastPageRead &&
              report.materialChecks.answerMatched &&
              report.materialChecks.sourcePositionMatched &&
              report.metrics.filter((m) => m.phase === "workspace_chat").length >= 2 &&
              report.metrics.at(-1)?.phase === "workspace_audit")) &&
          (report.featureCase !== "video_media" ||
            (report.attempts === 3 &&
              report.metrics.length === 3 &&
              report.metrics.every(
                (metric, i) =>
                  metric.status === "success" && metric.phase === (i === 2 ? "asr" : "vision"),
              ) &&
              report.mediaChecks?.length === 3 &&
              report.mediaChecks[0]?.phase === "vision" &&
              report.mediaChecks[0]?.videoFrame?.timestampSeconds === 1.4 &&
              report.mediaChecks[0]?.videoFrame?.frameIndex === 14 &&
              report.mediaChecks[1]?.phase === "vision" &&
              report.mediaChecks[1]?.videoFrame?.timestampSeconds === 3.2 &&
              report.mediaChecks[1]?.videoFrame?.frameIndex === 32 &&
              report.mediaChecks[2]?.phase === "asr" &&
              report.mediaChecks[2]?.videoFrame === undefined &&
              (report.mediaChecks[2]?.segmentCount ?? 0) > 0 &&
              report.mediaChecks.every((check) => check.markerMatched))) &&
          (report.featureCase !== "legal_chat" ||
            (report.legalChecks !== undefined &&
              report.legalChecks.requests > 0 &&
              report.legalChecks.verifiedSourceCount > 0 &&
              report.legalChecks.acceptedQuotationCount > 0 &&
              report.legalChecks.sourceFailures.length === 0 &&
              report.metrics.filter((metric) => metric.phase === "workspace_chat").length >= 2 &&
              report.metrics.at(-1)?.phase === "workspace_audit")) &&
          (report.featureCase !== "media" ||
            (report.mediaChecks?.length === 2 &&
              report.mediaChecks[0]?.phase === "vision" &&
              report.mediaChecks[1]?.phase === "asr" &&
              report.mediaChecks.every((check) => check.markerMatched)))
        : report.failure !== null),
    "Probe outcome and attempt evidence must agree",
  );
export type ProbeReport = z.infer<typeof reportSchema>;
export function probeReportFor(provenance: ProbeProvenance) {
  return reportSchema.refine(
    (report) =>
      report.candidateSha === provenance.candidateSha &&
      report.featureCase === provenance.featureCase &&
      report.probeSourceSha256 === provenance.probeSourceSha256,
    "Probe report provenance mismatch",
  );
}
export const controlSchema = z.strictObject({
  protocolVersion: z.literal(PROBE_PROTOCOL_VERSION),
  activeCandidateSha: candidateSchema.nullable(),
  activeFeatureCase: featureCaseSchema.nullable(),
  activeProbeSourceSha256: hashSchema.nullable(),
  configurationReady: z.boolean(),
  started: z.boolean(),
  attempts: z.number().int().min(0).max(3),
  storedReport: z.unknown().nullable(),
  terminalFailure: runtimeFailureSchema.nullable(),
});
export type ProbeControl = z.infer<typeof controlSchema>;
export const probeBlockReasonSchema = z.enum([
  "INVALID_CANDIDATE",
  "CANDIDATE_HEAD_MISMATCH",
  "SOURCE_TREE_DIRTY",
  "STATUS_UNAVAILABLE",
  "CONTROL_INVALID",
  "ACTIVE_PROVENANCE_MISMATCH",
  "STORED_REPORT_INVALID",
  "STATE_INCONSISTENT",
  "PREVIOUS_OUTCOME_INCOMPLETE",
  "MODEL_RESPONSE_INVALID",
  "REPLAY_NOT_REJECTED",
  "REPLAY_STATE_CHANGED",
]);
export class ProbeControlError extends Error {
  constructor(readonly code: z.infer<typeof probeBlockReasonSchema>) {
    super(code);
  }
}
export function assertGitCandidate(candidate: string, head: string, status: string): void {
  if (!candidateSchema.safeParse(candidate).success)
    throw new ProbeControlError("INVALID_CANDIDATE");
  if (candidate !== head.trim()) throw new ProbeControlError("CANDIDATE_HEAD_MISMATCH");
  if (status.trim()) throw new ProbeControlError("SOURCE_TREE_DIRTY");
}
export function activeProvenance(env: ProbeConfiguration): ProbeProvenance | null {
  const parsed = provenanceSchema.safeParse({
    featureCase: env.READINESS_FEATURE_CASE ?? "workspace_questions",
    candidateSha: env.READINESS_CANDIDATE_SHA,
    probeSourceSha256: env.READINESS_PROBE_SHA256,
  });
  return parsed.success ? parsed.data : null;
}
const headers = {
  candidate: "x-baro-probe-candidate",
  hash: "x-baro-probe-source",
  protocol: "x-baro-probe-protocol",
  feature: "x-baro-probe-feature",
} as const;
export function authorizedProbeRequest(request: Request, env: ProbeConfiguration): Request | null {
  const active = activeProvenance(env);
  if (
    !active ||
    !env.READINESS_TOKEN ||
    !["GET", "POST"].includes(request.method) ||
    new URL(request.url).pathname !== "/probe" ||
    request.headers.get("authorization") !== `Bearer ${env.READINESS_TOKEN}`
  )
    return null;
  const forwarded = new Request(request);
  // Never trust provenance supplied by a caller, even an authenticated caller.
  forwarded.headers.set(headers.candidate, active.candidateSha);
  forwarded.headers.set(headers.feature, active.featureCase);
  forwarded.headers.set(headers.hash, active.probeSourceSha256);
  forwarded.headers.set(headers.protocol, String(PROBE_PROTOCOL_VERSION));
  return forwarded;
}
export function requestMatchesActive(request: Request, active: ProbeProvenance | null): boolean {
  return (
    active !== null &&
    request.headers.get(headers.candidate) === active.candidateSha &&
    request.headers.get(headers.feature) === active.featureCase &&
    request.headers.get(headers.hash) === active.probeSourceSha256 &&
    request.headers.get(headers.protocol) === String(PROBE_PROTOCOL_VERSION)
  );
}
export type ProbeDecision =
  | { action: "post" }
  | { action: "reuse"; report: ProbeReport }
  | { action: "blocked"; reason: z.infer<typeof probeBlockReasonSchema> };
export function decideProbeAction(body: unknown, expected: ProbeProvenance): ProbeDecision {
  const parsed = controlSchema.safeParse(body);
  if (!parsed.success) return { action: "blocked", reason: "CONTROL_INVALID" };
  const state = parsed.data;
  if (
    !state.configurationReady ||
    state.activeCandidateSha !== expected.candidateSha ||
    state.activeFeatureCase !== expected.featureCase ||
    state.activeProbeSourceSha256 !== expected.probeSourceSha256
  )
    return { action: "blocked", reason: "ACTIVE_PROVENANCE_MISMATCH" };
  if (state.storedReport !== null) {
    const report = probeReportFor(expected).safeParse(state.storedReport);
    if (!report.success) return { action: "blocked", reason: "STORED_REPORT_INVALID" };
    if (!state.started || state.attempts !== report.data.attempts || state.terminalFailure !== null)
      return { action: "blocked", reason: "STATE_INCONSISTENT" };
    return { action: "reuse", report: report.data };
  }
  if (state.started || state.attempts !== 0 || state.terminalFailure !== null)
    return { action: "blocked", reason: "PREVIOUS_OUTCOME_INCOMPLETE" };
  return { action: "post" };
}
export interface ProbeTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}
export interface ProbeStorage extends ProbeTransaction {
  transaction<T>(callback: (transaction: ProbeTransaction) => Promise<T>): Promise<T>;
}
export interface ProbeOutcome {
  status: "passed" | "failed";
  failure: "MODEL_UNAVAILABLE" | "MODEL_SCHEMA_INVALID" | "POLICY_REJECTED" | null;
  metrics: (
    | ModelMetric
    | {
        requestId: string;
        phase: "vision" | "asr";
        model: typeof MODEL_ID | "@cf/openai/whisper-large-v3-turbo";
        latencyMs: number;
        inputTokens: number | null;
        outputTokens: number | null;
        status: "success" | "failed";
      }
  )[];
  providerFailures?: z.infer<typeof probeProviderFailureSchema>[];
  mediaChecks?: z.infer<typeof mediaChecksSchema>;
  policyFailure?: z.infer<typeof probePolicyFailureSchema>;
  legalChecks?: z.infer<typeof legalChecksSchema>;
  materialChecks?: z.infer<typeof materialChecksSchema>;
  comparisonChecks?: z.infer<typeof comparisonChecksSchema>;
  comparisonEvidence?: z.infer<typeof comparisonEvidenceObservationSchema>[];
}
export async function handleDurableProbe(
  request: Request,
  env: ProbeConfiguration,
  storage: ProbeStorage,
  execute: (reserve: () => Promise<boolean>) => Promise<ProbeOutcome>,
  now: () => string = () => new Date().toISOString(),
): Promise<Response> {
  const active = activeProvenance(env);
  if (!["GET", "POST"].includes(request.method))
    return Response.json({ status: "unavailable" }, { status: 405 });
  // POST can never acquire state or reserve cost using another deployment's metadata.
  if (request.method === "POST" && !requestMatchesActive(request, active))
    return Response.json({ status: "probe-configuration-mismatch" }, { status: 409 });
  let stage: z.infer<typeof runtimeFailureSchema>["stage"] = "read-state";
  try {
    if (request.method === "GET") {
      return Response.json({
        protocolVersion: PROBE_PROTOCOL_VERSION,
        activeCandidateSha: active?.candidateSha ?? null,
        activeFeatureCase: active?.featureCase ?? null,
        activeProbeSourceSha256: active?.probeSourceSha256 ?? null,
        configurationReady: active !== null,
        started: (await storage.get("started")) === true,
        attempts: (await storage.get<number>("calls")) ?? 0,
        // Persisted provenance must survive unchanged after new deployments.
        storedReport: (await storage.get("report")) ?? null,
        terminalFailure: (await storage.get("terminalFailure")) ?? null,
      });
    }
    if (!active) return Response.json({ status: "probe-configuration-mismatch" }, { status: 409 });
    stage = "acquire";
    const acquired = await storage.transaction(async (txn) => {
      if (
        (await txn.get("started")) ||
        (await txn.get("report")) !== undefined ||
        (await txn.get("terminalFailure")) !== undefined ||
        ((await txn.get<number>("calls")) ?? 0) !== 0
      )
        return false;
      await txn.put("provenance", active);
      await txn.put("started", true);
      return true;
    });
    if (!acquired) return Response.json({ status: "already-attempted" }, { status: 409 });
    const reserve = () =>
      storage.transaction(async (txn) => {
        const stored = provenanceSchema.safeParse(await txn.get("provenance"));
        const calls = (await txn.get<number>("calls")) ?? 0;
        if (
          !stored.success ||
          stored.data.candidateSha !== active.candidateSha ||
          stored.data.featureCase !== active.featureCase ||
          stored.data.probeSourceSha256 !== active.probeSourceSha256 ||
          (await txn.get("started")) !== true ||
          calls >= 3
        )
          return false;
        await txn.put("calls", calls + 1);
        return true;
      });
    stage = "model";
    const outcome = await execute(reserve);
    stage = "write-report";
    const attempts = (await storage.get<number>("calls")) ?? 0;
    const report = probeReportFor(active).parse({
      version: PROBE_PROTOCOL_VERSION,
      checkedAt: now(),
      ...active,
      environment: "isolated-synthetic-worker",
      ...outcome,
      runtimeWorker: true,
      attempts,
      metricCoverage: outcome.metrics.length === attempts ? "complete" : "partial",
      unverified: [...unverified],
    });
    await storage.put("report", report);
    return Response.json(report, { status: report.status === "passed" ? 200 : 502 });
  } catch (error) {
    const failure = {
      stage,
      category:
        error instanceof TypeError ? ("type-error" as const) : ("probe-runtime-error" as const),
    };
    try {
      await storage.put("terminalFailure", failure);
    } catch {
      // Keep only finite metadata in the response if storage is also unavailable.
    }
    return Response.json({ status: "probe-runtime-failed", failure }, { status: 502 });
  }
}
export interface ProbeReply {
  status: number;
  body: unknown;
}
export async function verifyProbeExchange(
  initial: ProbeReply,
  expected: ProbeProvenance,
  send: (method: "GET" | "POST") => Promise<ProbeReply>,
  onStage: (stage: "model-and-schema-check" | "durable-replay-check") => void = () => {},
): Promise<ProbeReport> {
  if (initial.status !== 200) throw new ProbeControlError("STATUS_UNAVAILABLE");
  const decision = decideProbeAction(initial.body, expected);
  if (decision.action === "blocked") throw new ProbeControlError(decision.reason);
  onStage("model-and-schema-check");
  let report: ProbeReport;
  if (decision.action === "reuse") report = decision.report;
  else {
    // Exactly one POST. A timeout or ambiguous response must never trigger another.
    const response = await send("POST");
    const parsed = probeReportFor(expected).safeParse(response.body);
    if (!parsed.success || response.status !== (parsed.data.status === "passed" ? 200 : 502))
      throw new ProbeControlError("MODEL_RESPONSE_INVALID");
    report = parsed.data;
  }
  onStage("durable-replay-check");
  const replay = await send("POST");
  if (
    replay.status !== 409 ||
    !z.strictObject({ status: z.literal("already-attempted") }).safeParse(replay.body).success
  )
    throw new ProbeControlError("REPLAY_NOT_REJECTED");
  const after = await send("GET");
  const unchanged = after.status === 200 ? decideProbeAction(after.body, expected) : null;
  if (unchanged?.action !== "reuse" || JSON.stringify(unchanged.report) !== JSON.stringify(report))
    throw new ProbeControlError("REPLAY_STATE_CHANGED");
  return report;
}
