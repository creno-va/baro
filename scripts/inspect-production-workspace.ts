import { z } from "zod";
import { opaqueIdSchema } from "../src/contracts";
import { safeClaimFailure } from "../src/server/modules/citation/claim-diagnostics";
import { safeLegalAnalysisFailure } from "../src/server/modules/legal-retrieval/analysis/diagnostics";
import { NO_NEWER_CONFLICTING_SOURCE_SQL } from "../src/server/modules/legal-retrieval/v2/source-authority";
import { safeModelSchemaFailure } from "../src/server/modules/llm-gateway/schema-diagnostics";
import { safeWorkspaceAuditFailure } from "../src/server/modules/workspace/audit-diagnostics";
import { safeWorkspaceContentFailure } from "../src/server/modules/workspace/content-diagnostics";
import { safeWorkspacePublicationFailure } from "../src/server/workspace-publication-diagnostics";

const account = "9e844969d0c44b2449f3951d1f301654";
const databases = {
  production: "fa914862-848d-4eb1-bc69-e82a020df11a",
  preview: "c1612b14-6ab1-4d2e-82dc-33e596b31337",
} as const;
const inputSchema = z.object({
  token: z.string().min(1),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  workspaceId: z.uuid(),
  environment: z.enum(["production", "preview"]).default("production"),
});
const modelReceiptGroupSchema = z.object({
  state: z.enum(["prepared", "dispatched", "final", "unknown"]),
  transport: z.enum(["not_sent", "response", "unknown", "provider_error"]).nullable(),
  receipts: z.number().int().min(0).max(1_000_000),
});
const revisionBoundarySchema = z.object({
  kind: z.enum([
    "workspace",
    "job",
    "report",
    "analysis",
    "task",
    "checkpoint",
    "reconciliation",
    "source_binding",
  ]),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  relatedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  summaryRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  proof: z.number().int().min(0).max(1).nullable(),
});
const jobSchema = z.object({
  id: opaqueIdSchema,
  runtime_instance_id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  kind: z.enum([
    "intake_questions",
    "intake_summary",
    "chat_response",
    "file_processing",
    "report_build",
  ]),
  status: z.enum([
    "queued",
    "running",
    "validating",
    "completed",
    "failed",
    "cancelled",
    "superseded",
  ]),
  failure_code: z
    .string()
    .regex(/^[A-Z_]{1,64}$/)
    .nullable(),
  attempts: z.number().int().min(0).max(10),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  native_transport: z.enum(["not_sent", "response", "unknown"]).nullable().optional(),
});
const policySchema = z.enum([
  "unauthorized_reference",
  "unsupported_fact",
  "prohibited_content",
  "question_repetition",
  "audit_rejected",
  "policy_rejected",
]);
export function finiteWorkspaceOutput(raw: unknown) {
  const value = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!value.success) return null;
  const data = value.data;
  const timings = z
    .array(
      z.object({
        stage: z.enum(["context", "generation", "retrieval", "audit", "publication"]),
        durationMs: z.number().int().min(0).max(1_200_000),
        outcome: z.enum(["completed", "failed"]),
      }),
    )
    .max(20)
    .safeParse(data.stageTimings);
  const policy = policySchema.safeParse(data.policyReason);
  const fact = z
    .object({
      category: z.enum([
        "source_text_unavailable",
        "source_text_mismatch",
        "claim_text_missing",
        "claim_reference_mismatch",
        "unknown",
      ]),
      attribution: z.enum([
        "user_statement",
        "user_material",
        "official_source",
        "ai_organization",
        "unknown",
      ]),
      referenceKind: z.enum([
        "intake_narrative",
        "intake_answer",
        "user_message",
        "user_material",
        "official_source",
        "mixed",
        "none",
        "unknown",
      ]),
      factCount: z.number().int().min(0).max(1000).nullable(),
      referenceCount: z.number().int().min(0).max(1000).nullable(),
      availableSourceCount: z.number().int().min(0).max(1000).nullable(),
    })
    .safeParse(data.factFailure);
  return {
    ...(safeLegalAnalysisFailure(data.analysisFailure)
      ? { analysisFailure: safeLegalAnalysisFailure(data.analysisFailure) }
      : {}),
    ...(safeModelSchemaFailure(data.schemaFailure)
      ? { schemaFailure: safeModelSchemaFailure(data.schemaFailure) }
      : {}),
    ...(timings.success ? { stageTimings: timings.data } : {}),
    ...(policy.success ? { policyReason: policy.data } : {}),
    ...(fact.success ? { factFailure: fact.data } : {}),
    ...(safeWorkspacePublicationFailure(data.publicationFailure)
      ? { publicationFailure: safeWorkspacePublicationFailure(data.publicationFailure) }
      : {}),
    ...(safeClaimFailure(data.claimFailure)
      ? { claimFailure: safeClaimFailure(data.claimFailure) }
      : {}),
    ...(safeWorkspaceAuditFailure(data.auditFailure)
      ? { auditFailure: safeWorkspaceAuditFailure(data.auditFailure) }
      : {}),
    ...(safeWorkspaceContentFailure(data.contentFailure)
      ? { contentFailure: safeWorkspaceContentFailure(data.contentFailure) }
      : {}),
  };
}
/** Traverse only known telemetry envelope fields; the caller validates finite diagnostic enums. */
export function telemetryCandidates(raw: unknown, depth = 0): unknown[] {
  if (depth > 8) return [];
  if (typeof raw === "string") {
    if (raw.length > 8192) return [];
    try {
      return telemetryCandidates(JSON.parse(raw), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw))
    return raw.slice(0, 30).flatMap((value) => telemetryCandidates(value, depth + 1));
  if (!raw || typeof raw !== "object") return [];
  const value = raw as Record<string, unknown>;
  return [
    raw,
    ...["source", "message", "logs", "$metadata"].flatMap((key) =>
      telemetryCandidates(value[key], depth + 1),
    ),
  ];
}
/** Operator-only read port. No credentials, ciphertext, case text, SQL errors or raw logs leave it. */
export async function inspectProductionWorkspace(
  raw: unknown,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  observe: (stage: "release" | "jobs" | "workflow" | "telemetry") => void = () => {},
  options: { completedModelReceipts?: boolean; revisionBoundary?: boolean } = {},
) {
  const input = inputSchema.parse(raw);
  observe("release");
  const origin =
    input.environment === "preview" ? "https://preview.baro.site" : "https://baro.site";
  const live = await fetcher(`${origin}/api/health/ready`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  if (
    !live.ok ||
    !z
      .object({
        release: z.literal(input.sha),
        environment: z.literal(input.environment),
        status: z.literal("ready"),
      })
      .safeParse(await live.json()).success
  )
    throw new Error("INSPECTION_RELEASE_MISMATCH");
  async function api(path: string, body?: unknown) {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("INSPECTION_READ_UNAVAILABLE");
    const parsed = z
      .object({ success: z.literal(true), result: z.unknown() })
      .safeParse(await response.json());
    if (!parsed.success) throw new Error("INSPECTION_READ_INVALID");
    return parsed.data.result;
  }
  observe("jobs");
  const result = await api(`d1/database/${databases[input.environment]}/query`, {
    sql: "SELECT id,runtime_instance_id,kind,status,failure_code,attempts,created_at,updated_at,(SELECT transport FROM v2_execution_admissions a WHERE a.job_id=j.id AND a.service='container' ORDER BY a.created_at DESC LIMIT 1) AS native_transport FROM v2_jobs j WHERE workspace_id=? ORDER BY created_at DESC LIMIT 12",
    params: [input.workspaceId],
  });
  const rows =
    z
      .array(z.object({ success: z.literal(true), results: z.array(jobSchema).max(12) }))
      .length(1)
      .parse(result)[0]?.results ?? [];
  const jobs = [];
  for (const row of rows) {
    let diagnostic: unknown = null;
    if (["intake_questions", "intake_summary", "chat_response"].includes(row.kind)) {
      observe("workflow");
      const instance = z
        .object({ output: z.unknown().optional() })
        .parse(
          await api(
            `workflows/baro-workspace-${input.environment}/instances/${row.runtime_instance_id}`,
          ),
        );
      diagnostic = finiteWorkspaceOutput(instance.output);
    }
    let schemaAttempts: unknown;
    let policyAttempts: unknown;
    let modelAttempts: unknown;
    if (
      (options.completedModelReceipts &&
        ["intake_questions", "intake_summary", "chat_response", "file_processing"].includes(
          row.kind,
        )) ||
      (row.kind === "chat_response" &&
        ["MODEL_SCHEMA_INVALID", "POLICY_REJECTED"].includes(row.failure_code ?? ""))
    ) {
      const observations = await api(`d1/database/${databases[input.environment]}/query`, {
        // Existing numeric observations only: never read wire text, identifiers,
        // amounts, credentials or model output. The ledger remains untouched.
        sql: "SELECT a.attempt,a.state,a.transport,(SELECT CAST(json_extract(q.value,'$.maximumQuantity') AS INTEGER) FROM json_each(a.payload_json,'$.plan.quantities') q WHERE json_extract(q.value,'$.sku')='model_output_tokens') AS maximum_output_tokens,(SELECT CAST(json_extract(q.value,'$.quantity') AS INTEGER) FROM v2_execution_cost_observations o,json_each(o.payload_json,'$.quantities') q WHERE o.attempt_id=a.attempt_id AND json_extract(q.value,'$.sku')='model_output_tokens' ORDER BY o.observed_at DESC LIMIT 1) AS output_tokens FROM v2_execution_admissions a WHERE a.job_id=? AND a.service='model' ORDER BY a.created_at,a.attempt LIMIT 12",
        params: [row.id],
      });
      const attempts = z
        .array(
          z.object({
            success: z.literal(true),
            results: z
              .array(
                z.object({
                  attempt: z.number().int().min(1).max(10),
                  state: z.enum(["prepared", "dispatched", "final", "unknown"]),
                  transport: z
                    .enum(["not_sent", "response", "unknown", "provider_error"])
                    .nullable(),
                  maximum_output_tokens: z.number().int().min(1).max(1_000_000).nullable(),
                  output_tokens: z.number().int().min(0).max(1_000_000).nullable(),
                }),
              )
              .max(12),
          }),
        )
        .length(1)
        .parse(observations)[0]?.results;
      // Receipts distinguish not-sent from observed responses; they never
      // establish whether policy rejection came from the provider or an audit.
      if (row.failure_code === "MODEL_SCHEMA_INVALID") schemaAttempts = attempts;
      else if (row.failure_code === "POLICY_REJECTED") policyAttempts = attempts;
      if (options.completedModelReceipts) modelAttempts = attempts;
    }
    jobs.push({
      ...row,
      diagnostic,
      ...(schemaAttempts ? { schemaAttempts } : {}),
      ...(policyAttempts ? { policyAttempts } : {}),
      ...(modelAttempts ? { modelAttempts } : {}),
    });
  }
  // Job detail is a bounded recent window. These finite aggregates cover every
  // model admission in this workspace, including older jobs outside that window.
  // A prepared or unknown receipt is never promoted to a successful paid call.
  let modelReceipts:
    | {
        scope: "all_workspace_model_admissions";
        receiptCount: number;
        byStateAndTransport: z.infer<typeof modelReceiptGroupSchema>[];
        recentJobWindow: number;
        attemptsPerJobWindow: number;
      }
    | undefined;
  if (options.completedModelReceipts) {
    const total = await api(`d1/database/${databases[input.environment]}/query`, {
      sql: "SELECT a.state,a.transport,COUNT(*) AS receipts FROM v2_execution_admissions a JOIN v2_jobs j ON j.id=a.job_id WHERE j.workspace_id=? AND a.service='model' GROUP BY a.state,a.transport LIMIT 20",
      params: [input.workspaceId],
    });
    const byStateAndTransport =
      z
        .array(
          z.object({
            success: z.literal(true),
            results: z.array(modelReceiptGroupSchema).max(20),
          }),
        )
        .length(1)
        .parse(total)[0]?.results ?? [];
    modelReceipts = {
      scope: "all_workspace_model_admissions" as const,
      receiptCount: byStateAndTransport.reduce((sum, row) => sum + row.receipts, 0),
      byStateAndTransport,
      recentJobWindow: 12,
      attemptsPerJobWindow: 12,
    };
  }
  let revisionBoundary: z.infer<typeof revisionBoundarySchema>[] | undefined;
  if (options.revisionBoundary) {
    const boundary = await api(`d1/database/${databases[input.environment]}/query`, {
      // Numeric publication identities only. Never select private payloads,
      // prompts, source bodies, tokens, amounts or unbounded error strings.
      sql: `SELECT 'workspace' kind,revision,confirmed_summary_revision relatedRevision,NULL summaryRevision,CASE WHEN current_job_id IS NULL THEN 1 ELSE 0 END proof FROM v2_workspaces WHERE id=?
UNION ALL SELECT 'job',target_revision,attempts,NULL,CASE WHEN status='completed' THEN 1 ELSE 0 END FROM v2_jobs WHERE workspace_id=? AND kind='chat_response'
UNION ALL SELECT 'report',r.revision,r.workspace_revision,r.summary_revision,CASE WHEN EXISTS(SELECT 1 FROM v2_operations o JOIN v2_jobs j ON j.operation_id=o.id JOIN v2_private_snapshots s ON s.id=r.snapshot_id WHERE o.id=r.operation_id AND o.workspace_id=r.workspace_id AND o.kind='report' AND o.revision=r.workspace_revision AND j.target_kind='report' AND j.target_id=r.id AND j.target_revision=r.workspace_revision AND j.kind='report_build' AND s.owner_id=o.owner_id AND s.workspace_id=r.workspace_id AND s.target_id=r.id AND s.purpose='report' AND s.revision=r.workspace_revision AND s.state='published') THEN 1 ELSE 0 END FROM v2_reports r WHERE r.workspace_id=? AND r.id NOT LIKE 'export-%'
UNION ALL SELECT kind,revision,workspace_revision,NULL,NULL FROM v2_rework_records WHERE workspace_id=? AND state='published' AND kind IN ('analysis','task','checkpoint','reconciliation')
UNION ALL SELECT 'source_binding',count(*),coalesce(sum(CASE WHEN s.fetched_at<=? AND s.verified_at<=? AND s.expires_at>? AND ${NO_NEWER_CONFLICTING_SOURCE_SQL} THEN 1 ELSE 0 END),0),NULL,NULL FROM v2_citation_bindings c LEFT JOIN v2_official_sources s ON s.source_id=c.source_id WHERE c.workspace_id=? ORDER BY kind,revision DESC LIMIT 96`,
      params: [
        ...Array(4).fill(input.workspaceId),
        ...Array(3).fill(new Date().toISOString()),
        input.workspaceId,
      ],
    });
    revisionBoundary =
      z
        .array(
          z.object({ success: z.literal(true), results: z.array(revisionBoundarySchema).max(96) }),
        )
        .length(1)
        .parse(boundary)[0]?.results ?? [];
  }
  let telemetry: unknown = { status: "not_requested" };
  if (rows.length) {
    try {
      observe("telemetry");
      const from = Math.max(Date.parse(rows.at(-1)?.created_at ?? ""), Date.now() - 6 * 3600000);
      const to = Math.min(
        Date.now(),
        Math.max(...rows.map((row) => Date.parse(row.updated_at))) + 60000,
      );
      const logs = await api("workers/observability/telemetry/query", {
        queryId: "baro-report-dependency-inspection",
        timeframe: { from, to },
        // The REST API selects its response shape at the top level, outside parameters.
        view: "events",
        limit: 30,
        parameters: {
          needle: {
            value: "report_dependency_failure|file_processor_failure",
            isRegex: true,
            matchCase: true,
          },
        },
      });
      const events =
        z
          .object({
            events: z
              .object({
                events: z.array(
                  z.object({ source: z.unknown().optional(), $metadata: z.unknown().optional() }),
                ),
              })
              .optional(),
          })
          .parse(logs).events?.events ?? [];
      const finite = z.union([
        z.object({
          event: z.literal("report_dependency_failure"),
          stage: z.enum([
            "latest",
            "source",
            "create",
            "view",
            "font",
            "render",
            "persist",
            "unclassified",
          ]),
          category: z.enum([
            "database_constraint",
            "database_query",
            "database_limit",
            "database_unavailable",
            "crypto_unavailable",
            "input_invalid",
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
          code: z.enum([
            "DB_OPERATION_FAILED",
            "SNAPSHOT_INVALID",
            "SNAPSHOT_STREAM_REQUIRED",
            "REPOSITORY_INPUT_INVALID",
            "FORBIDDEN",
            "CRYPTO_DECRYPT_FAILED",
            "CRYPTO_CONFIGURATION_INVALID",
            "FILE_PROCESSING_FAILED",
            "FILE_REJECTED",
            "JOB_TIMEOUT",
            "STALE_REVISION",
            "REPORT_FONT_UNAVAILABLE",
            "REPORT_FONT_INVALID",
            "REPORT_RENDERER_UNAVAILABLE",
            "unknown",
          ]),
        }),
        z.object({
          event: z.literal("file_processor_failure"),
          stage: z.enum([
            "revocation_read",
            "reset",
            "capacity_wait",
            "startup",
            "dispatch",
            "response",
            "stream",
            "cleanup",
            "unclassified",
          ]),
          category: z.enum([
            "instance_unavailable",
            "start_rate_limited",
            "port_not_ready",
            "instance_stopped",
            "connection_lost",
            "startup_timeout",
            "cancelled",
            "invalid_output",
            "native_response_failed",
            "unknown",
          ]),
          durationMs: z.number().min(0).max(3600000).nullable(),
          httpStatus: z.number().int().min(400).max(599).nullable(),
        }),
      ]);
      telemetry = {
        status: "read",
        returnedEvents: events.length,
        events: events.flatMap((event) =>
          telemetryCandidates(event).flatMap((candidate) => {
            const parsed = finite.safeParse(candidate);
            return parsed.success ? [parsed.data] : [];
          }),
        ),
      };
    } catch {
      telemetry = { status: "unavailable" };
    }
  }
  return {
    environment: input.environment,
    release: input.sha,
    observedAt: new Date().toISOString(),
    jobs,
    telemetry,
    ...(modelReceipts ? { modelReceipts } : {}),
    ...(revisionBoundary ? { revisionBoundary } : {}),
  };
}
if (import.meta.main) {
  try {
    const result = await inspectProductionWorkspace(
      {
        token: process.env.CLOUDFLARE_API_TOKEN,
        sha: process.env.RECOVERY_EXPECTED_LIVE_SHA,
        workspaceId: process.env.INSPECT_WORKSPACE_ID,
        environment: process.env.INSPECT_ENVIRONMENT,
      },
      fetch,
      (stage) => console.info(JSON.stringify({ event: "production_inspection_stage", stage })),
      { completedModelReceipts: true, revisionBoundary: true },
    );
    await Bun.write(
      ".wrangler/readiness/production-inspection.json",
      JSON.stringify(result, null, 2),
    );
    console.info(JSON.stringify(result));
  } catch {
    console.error("Production inspection unavailable; no changes or provider calls were made.");
    process.exitCode = 1;
  }
}
