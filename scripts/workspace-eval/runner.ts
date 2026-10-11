import { z } from "zod";
import { V2_INTAKE_POLICY, type V2Fact } from "../../src/contracts/v2";
import { MODEL_ID, type Phase } from "../../src/server/modules/llm-gateway/prompts";
import {
  createLlmGateway,
  gatewayWireIdentity,
  ModelError,
  prepareGatewayWireInput,
} from "../../src/server/modules/llm-gateway/service";
import { createWorkspacePipeline } from "../../src/server/modules/workspace/pipeline";
import { CORPUS_VERSION, type Scenario, workspaceScenarios } from "./corpus";

export const humanChecks = [
  "facts",
  "dates",
  "attribution",
  "citations",
  "strategy",
  "coverage",
] as const;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const shaSchema = z.string().regex(/^(local|[a-f0-9]{40})$/);
const callSchema = z.strictObject({ wireInputSha256: digestSchema, response: z.unknown() });
const reviewSchema = z.strictObject({
  reviewer: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  checks: z
    .array(z.strictObject({ check: z.enum(humanChecks), result: z.enum(["pass", "critical"]) }))
    .length(humanChecks.length)
    .refine((items) => new Set(items.map((item) => item.check)).size === humanChecks.length),
});
export const replaySchema = z.strictObject({
  mode: z.literal("captured-response-replay"),
  candidateSha: shaSchema.refine((value) => value !== "local"),
  corpusVersion: z.literal(CORPUS_VERSION),
  corpusSha256: digestSchema,
  gatewayContractSha256: digestSchema,
  scenarios: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]{1,100}$/),
        calls: z.array(callSchema).max(20),
        humanReview: reviewSchema.optional(),
      }),
    )
    .length(workspaceScenarios.length),
});
export type Replay = z.infer<typeof replaySchema>;
export function completion(output: unknown) {
  return { choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }] };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Covers the complete current provider contract, including privacy flags and strict schema. */
export async function evaluationIdentity() {
  const corpus = workspaceScenarios.map(({ scripted: _scripted, ...scenario }) => scenario);
  return {
    corpusVersion: CORPUS_VERSION,
    corpusSha256: await hash(corpus),
    gatewayContractSha256: await hash({
      model: MODEL_ID,
      policy: V2_INTAKE_POLICY,
      wire: ["workspace_questions", "workspace_summary", "workspace_chat", "workspace_audit"].map(
        (phase) => prepareGatewayWireInput(phase as Phase, {}),
      ),
    }),
  };
}
export async function evaluationPlan(candidateSha: string) {
  shaSchema.parse(candidateSha);
  return {
    candidateSha,
    ...(await evaluationIdentity()),
    model: MODEL_ID,
    policy: V2_INTAKE_POLICY,
    humanChecks,
    replaySchema: z.toJSONSchema(replaySchema),
    // Only synthetic contexts; scripted expected model responses are deliberately omitted.
    scenarios: workspaceScenarios.map(({ scripted: _scripted, ...scenario }) => scenario),
    pending: [
      "live-provider-execution",
      "trusted-runtime-receipts",
      "independent-human-review",
      "integrated-ui-report-receipts",
    ],
  };
}
function findings(s: Scenario, output: unknown): string[] {
  const o = output as {
    facts?: V2Fact[];
    unknowns?: string[];
    questions?: unknown[];
    warnings?: string[];
    timeline?: { date: string | null; datePrecision: string }[];
    citations?: unknown[];
    text?: string;
  };
  const result: string[] = [];
  for (const expected of s.requiredFacts ?? []) {
    if (
      !o.facts?.some(
        (f) =>
          f.text === expected.text &&
          f.attribution === expected.attribution &&
          f.certainty === expected.certainty &&
          f.significance === expected.significance &&
          !f.userEdited,
      )
    )
      result.push("required_fact_not_preserved");
  }
  if (s.unknowns && !o.unknowns?.length) result.push("unknowns_not_preserved");
  if (
    s.phase === "workspace_questions" &&
    (!o.questions?.length || o.questions.length > V2_INTAKE_POLICY.questionsPerBatch)
  )
    result.push("question_limit");
  if (
    s.date &&
    (!o.timeline?.length ||
      o.timeline.some(
        (entry) => entry.date !== s.date?.date || entry.datePrecision !== s.date?.datePrecision,
      ))
  )
    result.push("date_precision");
  if (
    s.conflict &&
    !o.facts?.some(
      (f) => f.certainty === "conflicting" && f.conflictingFactIds.includes("old_fact"),
    )
  )
    result.push("conflict_not_preserved");
  if (
    s.sourceWarning &&
    (!o.warnings?.some((warning) => warning.includes("공식 자료를 확인하지 못해")) ||
      o.citations?.length)
  )
    result.push("source_failure_not_preserved");
  if (s.handoff && (!o.text?.includes("변호사") || !/자료|정리|상담/.test(o.text)))
    result.push("strategy_handoff_missing");
  return result;
}
const approvedAudit = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
type CapturedCall = z.infer<typeof callSchema>;
async function scenarioRun(s: Scenario, calls?: CapturedCall[]) {
  let cursor = 0;
  const captured: CapturedCall[] = [];
  let mismatch = false;
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "offline-evaluation",
      APP_ENV: "test",
      AI: {
        async run(model, input, options) {
          if (
            model !== MODEL_ID ||
            options.gateway.collectLog !== false ||
            !options.gateway.skipCache
          )
            throw new Error("EVAL_GATEWAY_CONTRACT");
          const identity = await gatewayWireIdentity(
            input as ReturnType<typeof prepareGatewayWireInput>,
          );
          const stored = calls?.[cursor++];
          if (calls && (!stored || stored.wireInputSha256 !== identity.wireInputSha256)) {
            mismatch = true;
            throw new Error("EVAL_REPLAY_INPUT_MISMATCH");
          }
          const format = input.response_format as { json_schema: { name: string } };
          const response = calls
            ? stored?.response
            : completion(
                format.json_schema.name.includes("workspace_audit") ? approvedAudit : s.scripted,
              );
          captured.push({
            wireInputSha256: identity.wireInputSha256,
            response: structuredClone(response),
          });
          return structuredClone(response);
        },
      },
    },
    { sleep: async () => {} },
  );
  const pipeline = createWorkspacePipeline(gateway, {
    reserve: async () => true,
    invocation: () => crypto.randomUUID(),
  });
  let outcome: "published" | "blocked" | "failed" = "failed";
  let critical: string[] = [];
  try {
    const c = structuredClone(s.context);
    const output =
      s.phase === "workspace_questions"
        ? { questions: await pipeline.questions(c, s.id) }
        : s.phase === "workspace_summary"
          ? await pipeline.summary(c, s.id)
          : await pipeline.chat(c, s.id);
    outcome = "published";
    critical = s.blocked ? ["gate_bypassed"] : findings(s, output);
  } catch (error) {
    if (
      s.blocked &&
      error instanceof ModelError &&
      error.code === "POLICY_REJECTED" &&
      captured.length === 0
    )
      outcome = "blocked";
    else critical = [error instanceof ModelError ? error.code : "EVAL_EXECUTION_FAILED"];
  }
  if (mismatch || (calls && cursor !== calls.length)) throw new Error("EVAL_REPLAY_INPUT_MISMATCH");
  return { report: { id: s.id, outcome, calls: captured.length, critical }, captured };
}
/** No remote binding/network is created here. Replay never proves live execution, cost or privacy. */
export async function evaluateWorkspace(candidateSha: string, rawReplay?: unknown) {
  shaSchema.parse(candidateSha);
  const identity = await evaluationIdentity();
  const replay = rawReplay === undefined ? undefined : replaySchema.parse(rawReplay);
  if (
    replay &&
    (replay.candidateSha !== candidateSha ||
      replay.corpusSha256 !== identity.corpusSha256 ||
      replay.gatewayContractSha256 !== identity.gatewayContractSha256)
  )
    throw new Error("EVAL_CANDIDATE_MISMATCH");
  const byId = new Map(replay?.scenarios.map((s) => [s.id, s]));
  if (
    replay &&
    (byId.size !== workspaceScenarios.length || workspaceScenarios.some((s) => !byId.has(s.id)))
  )
    throw new Error("EVAL_SCENARIO_COVERAGE");
  const reports = [];
  const scenarios: Replay["scenarios"] = [];
  for (const s of workspaceScenarios) {
    const recorded = byId.get(s.id);
    const { report, captured } = await scenarioRun(s, recorded?.calls);
    const review = recorded?.humanReview;
    reports.push({
      ...report,
      humanReview: review ? ("reported-unverified" as const) : ("missing" as const),
      humanCritical:
        review?.checks.filter((c) => c.result === "critical").map((c) => c.check) ?? [],
    });
    scenarios.push({ id: s.id, calls: captured });
  }
  return {
    report: {
      mode: replay ? "captured-response-replay" : "scripted-v2-pipeline",
      candidateSha,
      ...identity,
      model: MODEL_ID,
      policy: V2_INTAKE_POLICY,
      scenarios: reports,
      deterministicCritical: reports.reduce((sum, r) => sum + r.critical.length, 0),
      reportedHumanCritical: reports.reduce((sum, r) => sum + r.humanCritical.length, 0),
      missingHumanReviews: reports.filter((r) => r.humanReview === "missing").length,
      // An authentic runtime/CI resolver is required before V18 or issue closure can be asserted.
      liveExecutionVerified: false,
      closureReady: false,
      pending: [
        "live-provider-execution",
        "trusted-runtime-receipts",
        "independent-human-review",
        "integrated-ui-report-receipts",
      ],
    },
    // Only callers deliberately retaining synthetic fixture/captured responses get this private trace.
    replay: { mode: "captured-response-replay" as const, candidateSha, ...identity, scenarios },
  };
}
