import {
  safeLegalOutcome,
  safeLegalRejection,
  safeLegalRequest,
} from "./modules/legal-retrieval/diagnostics";
import { safeLegalSchemaDiagnostic } from "./modules/legal-retrieval/v2/schema-diagnostics";

/** Static categories only: original messages, SQL, identities and causes never leave here. */
export type DependencyCategory =
  | "database_constraint"
  | "database_query"
  | "database_limit"
  | "database_unavailable"
  | "crypto_unavailable"
  | "input_invalid"
  | "provider_schema"
  | "provider_model"
  | "provider_auth"
  | "provider_budget"
  | "provider_rate"
  | "provider_timeout"
  | "provider_request"
  | "provider_unavailable"
  | "unknown";
export type DependencyStage =
  | "retry_job"
  | "retry_workspace"
  | "retry_operation"
  | "retry_context"
  | "retry_admission"
  | "retry_commit"
  | "retry_receipt";
const failures = new WeakMap<object, { category: DependencyCategory; stage?: DependencyStage }>();
export function dependencyCategory(error: unknown): DependencyCategory {
  if (!error || typeof error !== "object") return "unknown";
  const known = failures.get(error);
  if (known) return known.category;
  const code = "code" in error ? error.code : null;
  if (code === "CRYPTO_DECRYPT_FAILED" || code === "CRYPTO_CONFIGURATION_INVALID")
    return "crypto_unavailable";
  if (code === "REPOSITORY_INPUT_INVALID" || ("name" in error && error.name === "ZodError"))
    return "input_invalid";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  if (/constraint failed|FOREIGN KEY constraint|UNIQUE constraint/i.test(message))
    return "database_constraint";
  if (/ambiguous column|no such (?:column|table)|syntax error/i.test(message))
    return "database_query";
  if (
    /too many SQL variables|too many subrequests|SQLITE_TOOBIG|query.*too (?:large|complex)|expression tree is too large|too many terms in compound SELECT|too many arguments on function/i.test(
      message,
    )
  )
    return "database_limit";
  if (/D1_ERROR|D1_EXEC_ERROR|SQLITE_BUSY/i.test(message)) return "database_unavailable";
  if (
    /invalid.*(?:schema|response_format)|(?:oneOf|schema).*not (?:permitted|supported)/i.test(
      message,
    )
  )
    return "provider_schema";
  if (/model.*(?:not found|not supported|does not exist|unavailable)/i.test(message))
    return "provider_model";
  if (/unauthorized|authentication|invalid.*api.key/i.test(message)) return "provider_auth";
  if (/insufficient.*(?:credit|balance|quota)|payment required/i.test(message))
    return "provider_budget";
  if (/rate.limit/i.test(message)) return "provider_rate";
  return "unknown";
}
/** Retain only a category when repositories replace platform errors with safe errors. */
export function rememberDependencyFailure(
  target: object,
  original: unknown,
  fallback: DependencyCategory = "unknown",
) {
  const category = dependencyCategory(original);
  failures.set(target, { category: category === "unknown" ? fallback : category });
}
export async function dependencyStep<T>(
  stage: DependencyStage,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error && typeof error === "object") {
      failures.set(error, { category: dependencyCategory(error), stage });
    }
    throw error;
  }
}
export function reportDependencyFailure(error: unknown) {
  const failure = error && typeof error === "object" ? failures.get(error) : undefined;
  console.error(
    JSON.stringify({
      event: "workspace_dependency_failure",
      stage: failure?.stage ?? "unclassified",
      category: dependencyCategory(error),
    }),
  );
}

/** An accounting outage is separate from provider/product failure; never log the receipt. */
export function reportCostObservationFailure(phaseInput: string, error: unknown) {
  const phase = [
    "minimize",
    "screening",
    "structure",
    "questions",
    "generation",
    "validation",
    "workspace_questions",
    "workspace_summary",
    "workspace_precedent_compare",
    "workspace_chat",
    "workspace_audit",
  ].includes(phaseInput)
    ? phaseInput
    : "unclassified";
  const category = dependencyCategory(error);
  console.error(JSON.stringify({ event: "model_cost_observation_failure", phase, category }));
}

/** The optional financial bucket is not a workspace or model execution failure. */
export function reportMonthBucketObservationFailure(error: unknown) {
  const category = dependencyCategory(error);
  console.error(
    JSON.stringify({ event: "cost_observation_failure", phase: "month_bucket", category }),
  );
}

export function reportProviderFailure(failure: {
  phase: string;
  category: DependencyCategory;
  httpStatus: number | null;
}) {
  const legacyPhases = [
    "minimize",
    "screening",
    "structure",
    "questions",
    "generation",
    "validation",
  ];
  const phase = [
    ...legacyPhases,
    "workspace_questions",
    "workspace_summary",
    "workspace_precedent_compare",
    "workspace_chat",
    "workspace_audit",
    "workspace_actions",
    "workspace_retrieval",
  ].includes(failure.phase)
    ? failure.phase
    : "unclassified";
  const category = [
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
  ].includes(failure.category)
    ? failure.category
    : "unknown";
  const httpStatus =
    typeof failure.httpStatus === "number" &&
    Number.isInteger(failure.httpStatus) &&
    failure.httpStatus >= 400 &&
    failure.httpStatus <= 599
      ? failure.httpStatus
      : null;
  console.error(
    JSON.stringify({ event: "workspace_provider_failure", phase, category, httpStatus }),
  );
}

/** Retrieval diagnostics never include query text, URLs, source bodies or credentials. */
export function reportLegalRetrieval(outcome: {
  kind: string;
  availability: string;
  reason: string | null;
  schemaFailure?: unknown;
}) {
  const kind = ["statute", "precedent", "official_guide"].includes(outcome.kind)
    ? outcome.kind
    : "unknown";
  const availability = ["verified", "limited", "unavailable", "not_requested"].includes(
    outcome.availability,
  )
    ? outcome.availability
    : "unknown";
  const reason =
    outcome.reason === null
      ? null
      : [
            "configuration_missing",
            "not_authorized",
            "budget_exhausted",
            "cancelled",
            "timeout",
            "rate_limited",
            "upstream_unavailable",
            "upstream_rejected",
            "schema_mismatch",
            "too_large",
            "unsafe_url",
            "identity_mismatch",
            "date_invalid",
            "no_results",
            "history_incomplete",
            "unsupported_format",
            "rights_unverified",
            "unknown_publication_date",
            "update_pending",
            "image_omitted",
            "cache_invalid",
          ].includes(outcome.reason)
        ? outcome.reason
        : "unknown";
  console.error(JSON.stringify({ event: "workspace_legal_retrieval", kind, availability, reason }));
  const schemaFailure =
    reason === "schema_mismatch" ? safeLegalSchemaDiagnostic(outcome.schemaFailure) : undefined;
  return { kind, availability, reason, ...(schemaFailure ? { schemaFailure } : {}) };
}

/** Keep a generated draft private even when explaining why it was rejected. */
export function reportWorkspacePolicyFailure(value: unknown) {
  const reason =
    typeof value === "string" &&
    [
      "unauthorized_reference",
      "unsupported_fact",
      "prohibited_content",
      "question_repetition",
      "audit_rejected",
      "policy_rejected",
    ].includes(value)
      ? value
      : "unknown";
  console.error(JSON.stringify({ event: "workspace_policy_failure", reason }));
  return reason;
}

export type WorkspaceFactFailure = {
  category:
    | "source_text_unavailable"
    | "source_text_mismatch"
    | "claim_text_missing"
    | "claim_reference_mismatch";
  attribution: "user_statement" | "user_material" | "official_source" | "ai_organization";
  referenceKind:
    | "intake_narrative"
    | "intake_answer"
    | "user_message"
    | "user_material"
    | "official_source"
    | "mixed"
    | "none";
  factCount: number;
  referenceCount: number;
  availableSourceCount: number;
};

/** Explain a rejected attribution without recording text, IDs or source lengths. */
export function reportWorkspaceFactFailure(value: unknown, boundary: unknown) {
  const detail = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const select = (candidate: unknown, allowed: readonly string[]) =>
    typeof candidate === "string" && allowed.includes(candidate) ? candidate : "unknown";
  const count = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? Math.min(1000, Math.floor(candidate))
      : null;
  const stage = select(boundary, ["draft_retry", "terminal"]);
  const category = select(detail.category, [
    "source_text_unavailable",
    "source_text_mismatch",
    "claim_text_missing",
    "claim_reference_mismatch",
  ]);
  const attribution = select(detail.attribution, [
    "user_statement",
    "user_material",
    "official_source",
    "ai_organization",
  ]);
  const referenceKind = select(detail.referenceKind, [
    "intake_narrative",
    "intake_answer",
    "user_message",
    "user_material",
    "official_source",
    "mixed",
    "none",
  ]);
  const factCount = count(detail.factCount);
  const referenceCount = count(detail.referenceCount);
  const availableSourceCount = count(detail.availableSourceCount);
  console.error(
    JSON.stringify({
      event: "workspace_fact_failure",
      stage,
      category,
      attribution,
      referenceKind,
      factCount,
      referenceCount,
      availableSourceCount,
    }),
  );
  return {
    stage,
    category,
    attribution,
    referenceKind,
    factCount,
    referenceCount,
    availableSourceCount,
  };
}

/** Legal observations are finite validated metadata, never upstream payloads. */
export function reportLegalRequest(value: unknown) {
  const data = safeLegalRequest(value);
  if (!data || (data.reason === null && data.durationMs < 2000)) return;
  const { endpointId, attempt, durationMs, httpStatus, reason } = data;
  console.warn(
    JSON.stringify({
      event: "legal_request_observation",
      endpointId,
      attempt,
      durationMs,
      httpStatus,
      reason,
    }),
  );
}
export function reportLegalOutcome(value: unknown) {
  const data = safeLegalOutcome(value);
  if (!data || (data.availability === "verified" && !data.sourceFailures.length)) return;
  const { kind, availability, reason, sourceFailures, verifiedSourceCount, durationMs } = data;
  console.warn(
    JSON.stringify({
      event: "legal_source_observation",
      kind,
      availability,
      reason,
      sourceFailures,
      verifiedSourceCount,
      durationMs,
    }),
  );
}
export function reportLegalRejection(value: unknown) {
  const data = safeLegalRejection(value);
  if (!data) return;
  const { endpointId, category } = data;
  console.warn(JSON.stringify({ event: "legal_upstream_rejection", endpointId, category }));
}
