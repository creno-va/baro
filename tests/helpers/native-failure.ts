import { z } from "zod";
import { dependencyCategory } from "../../src/server/dependency-diagnostics";
import { nativeD1Operations } from "./native-measurements";

const names = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ZodError",
  "V2RepositoryError",
  "DrizzleQueryError",
] as const;
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
] as const;
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
] as const;
const categories = [
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
] as const;
const chainSchema = z
  .array(
    z.strictObject({
      name: z.enum([...names, "unknown"]),
      code: z.enum(codes).nullable(),
      category: z.enum(categories),
      knownFailure: z.enum(knownMessages).nullable(),
    }),
  )
  .max(3);
export const nativeFailureHistorySchema = z.strictObject({
  first: z
    .array(
      z.strictObject({
        operation: z.enum(nativeD1Operations).nullable(),
        details: chainSchema,
      }),
    )
    .max(8),
  omitted: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/** Keep the first bounded failures independently of per-request trace resets.
 * Captured errors are immediately reduced to the existing fixed allowlists. */
export function createNativeFailureHistory() {
  const first: z.infer<typeof nativeFailureHistorySchema>["first"] = [];
  let omitted = 0;
  return {
    capture(error: unknown, operation: unknown) {
      if (first.length === 8) {
        omitted = Math.min(Number.MAX_SAFE_INTEGER, omitted + 1);
        return;
      }
      first.push({
        operation: z.enum(nativeD1Operations).safeParse(operation).data ?? null,
        details: chainSchema.parse(nativeFailure(error)),
      });
    },
    snapshot: () => nativeFailureHistorySchema.parse({ first, omitted }),
  };
}

/** Synthetic test evidence only: never retain errors, messages, SQL or identities. */
export function nativeFailure(error: unknown) {
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
        name:
          typeof name === "string" && (names as readonly string[]).includes(name)
            ? name
            : "unknown",
        code: typeof code === "string" && (codes as readonly string[]).includes(code) ? code : null,
        category: dependencyCategory(error),
        knownFailure:
          typeof message === "string" && (knownMessages as readonly string[]).includes(message)
            ? message
            : null,
      });
      error = "cause" in error ? error.cause : null;
    } catch {
      break;
    }
  }
  return chain;
}
