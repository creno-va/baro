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
    /too many SQL variables|too many subrequests|SQLITE_TOOBIG|query.*too (?:large|complex)/i.test(
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
export function rememberDependencyFailure(target: object, original: unknown) {
  failures.set(target, { category: dependencyCategory(original) });
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
export function reportProviderFailure(failure: {
  phase: string;
  category: DependencyCategory;
  httpStatus: number | null;
}) {
  const phase = [
    "workspace_questions",
    "workspace_summary",
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
