import { z } from "zod";
import type { ModelMetric } from "../src/server/modules/llm-gateway/service";

export const PROBE_PROTOCOL_VERSION = 2 as const;
export const PROBE_REQUEST_ID = "00000000-0000-4000-8000-000000000027" as const;
const candidateSchema = z.string().regex(/^[a-f0-9]{40}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const provenanceSchema = z.strictObject({
  candidateSha: candidateSchema,
  probeSourceSha256: hashSchema,
});
export type ProbeProvenance = z.infer<typeof provenanceSchema>;
export interface ProbeConfiguration {
  READINESS_CANDIDATE_SHA?: string | undefined;
  READINESS_PROBE_SHA256?: string | undefined;
  READINESS_TOKEN?: string | undefined;
}
export const runtimeFailureSchema = z.strictObject({
  stage: z.enum(["read-state", "acquire", "model", "write-report"]),
  category: z.enum(["type-error", "probe-runtime-error"]),
});
const unverified = [
  "full-product-smoke",
  "live-corpus-eval",
  "oauth",
  "legal",
  "public-policy",
] as const;
const reportSchema = z
  .strictObject({
    version: z.literal(PROBE_PROTOCOL_VERSION),
    checkedAt: z.iso.datetime(),
    candidateSha: candidateSchema,
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
          phase: z.literal("screening"),
          model: z.literal("openai/gpt-6-sol"),
          latencyMs: z.number().finite().min(0),
          inputTokens: z.number().int().min(0).nullable(),
          outputTokens: z.number().int().min(0).nullable(),
          status: z.enum(["success", "failed"]),
        }),
      )
      .max(3),
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
      report.metricCoverage ===
        (report.metrics.length === report.attempts ? "complete" : "partial") &&
      (report.status === "passed"
        ? report.failure === null &&
          report.attempts > 0 &&
          report.metrics.at(-1)?.status === "success"
        : report.failure !== null),
    "Probe outcome and attempt evidence must agree",
  );
export type ProbeReport = z.infer<typeof reportSchema>;
export function probeReportFor(provenance: ProbeProvenance) {
  return reportSchema.refine(
    (report) =>
      report.candidateSha === provenance.candidateSha &&
      report.probeSourceSha256 === provenance.probeSourceSha256,
    "Probe report provenance mismatch",
  );
}
export const controlSchema = z.strictObject({
  protocolVersion: z.literal(PROBE_PROTOCOL_VERSION),
  activeCandidateSha: candidateSchema.nullable(),
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
    candidateSha: env.READINESS_CANDIDATE_SHA,
    probeSourceSha256: env.READINESS_PROBE_SHA256,
  });
  return parsed.success ? parsed.data : null;
}
const headers = {
  candidate: "x-baro-probe-candidate",
  hash: "x-baro-probe-source",
  protocol: "x-baro-probe-protocol",
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
  forwarded.headers.set(headers.hash, active.probeSourceSha256);
  forwarded.headers.set(headers.protocol, String(PROBE_PROTOCOL_VERSION));
  return forwarded;
}
export function requestMatchesActive(request: Request, active: ProbeProvenance | null): boolean {
  return (
    active !== null &&
    request.headers.get(headers.candidate) === active.candidateSha &&
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
  metrics: ModelMetric[];
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
