import { dependencyCategory } from "../../src/server/dependency-diagnostics";

/** Synthetic test evidence only: never retain errors, messages, SQL or identities. */
export function nativeFailure(error: unknown) {
  const names = [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ZodError",
    "V2RepositoryError",
    "DrizzleQueryError",
  ];
  const codes = [
    "REPOSITORY_INPUT_INVALID",
    "DB_OPERATION_FAILED",
    "SNAPSHOT_INVALID",
    "SNAPSHOT_STREAM_REQUIRED",
    "FORBIDDEN",
    "CRYPTO_DECRYPT_FAILED",
    "CRYPTO_CONFIGURATION_INVALID",
    "BUDGET_UNAVAILABLE",
    "DEPENDENCY_UNAVAILABLE",
    "ConnectionRefused",
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "ERR_RUNTIME_FAILURE",
  ];
  const knownMessages = [
    "Native D1 measurement missing",
    "RUNTIME_HOLD_ACTOR_MISMATCH",
    "INVALID_JOB_INSERT",
    "RUNTIME_PROOF_TOO_LARGE",
    "RUNTIME_PRICE_MISSING",
    "RUNTIME_AMOUNT_INVALID",
    "Workspace unavailable",
    "Summary unavailable",
    "Selected material unavailable",
  ];
  const chain: {
    name: string;
    code: string | null;
    category: string;
    knownFailure: string | null;
  }[] = [];
  const seen = new Set<object>();
  for (
    let depth = 0;
    depth < 3 && error && typeof error === "object" && !seen.has(error);
    depth++
  ) {
    seen.add(error);
    try {
      const name = "name" in error ? error.name : null;
      const code = "code" in error ? error.code : null;
      const message = "message" in error ? error.message : null;
      chain.push({
        name: typeof name === "string" && names.includes(name) ? name : "unknown",
        code: typeof code === "string" && codes.includes(code) ? code : null,
        category: dependencyCategory(error),
        knownFailure:
          typeof message === "string" && knownMessages.includes(message) ? message : null,
      });
      error = "cause" in error ? error.cause : null;
    } catch {
      break;
    }
  }
  return chain;
}
