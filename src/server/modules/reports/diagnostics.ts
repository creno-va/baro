import { dependencyCategory } from "../../dependency-diagnostics";

type ReportReadStage = "latest" | "source" | "create" | "view";
const stages = new Set<string>(["latest", "source", "create", "view"]);
const failures = new WeakMap<object, string>();
const codes = new Set([
  "DB_OPERATION_FAILED",
  "SNAPSHOT_INVALID",
  "SNAPSHOT_STREAM_REQUIRED",
  "REPOSITORY_INPUT_INVALID",
  "FORBIDDEN",
  "CRYPTO_DECRYPT_FAILED",
  "CRYPTO_CONFIGURATION_INVALID",
]);

/** Keep only a finite stage; do not retain source data or add details to errors. */
export async function reportReadStep<T>(stage: ReportReadStage, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error && typeof error === "object")
      failures.set(error, stages.has(stage) ? stage : "unclassified");
    throw error;
  }
}

/** Static enums only. Never serialize the error, cause, message, stack or request. */
export function reportReadFailure(error: unknown) {
  const object = error && typeof error === "object" ? error : undefined;
  const stage = (object && failures.get(object)) ?? "unclassified";
  const category = dependencyCategory(error);
  const candidate = object && "code" in object ? object.code : null;
  const code = typeof candidate === "string" && codes.has(candidate) ? candidate : "unknown";
  console.error(JSON.stringify({ event: "report_dependency_failure", stage, category, code }));
}
