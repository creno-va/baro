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
  "AssertionError",
  "MiniflareCoreError [ERR_DISPOSED]",
  "MiniflareCoreError [ERR_RUNTIME_FAILURE]",
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
  "ERR_ASSERTION",
  "ERR_DISPOSED",
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
const assertionSchema = z.strictObject({
  generatedMessage: z.boolean().nullable(),
  operator: z.literal("==").nullable(),
  actual: z.enum(["true", "false", "null", "undefined", "other"]),
  expected: z.enum(["true", "false", "null", "undefined", "other"]),
  sites: z.strictObject({
    asyncClientStatus: z.boolean(),
    asyncResultType: z.boolean(),
    syncClientStatus: z.boolean(),
    responseStatus: z.boolean(),
    syncReplyIdentity: z.boolean(),
  }),
});
const chainSchema = z
  .array(
    z.strictObject({
      name: z.enum([...names, "unknown"]),
      code: z.enum(codes).nullable(),
      category: z.enum(categories),
      knownFailure: z.enum(knownMessages).nullable(),
      assertion: assertionSchema.optional(),
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

const unreadable = Symbol("unreadable");
function diagnosticProperty(error: object, key: string): unknown {
  try {
    return Reflect.get(error, key);
  } catch {
    return unreadable;
  }
}
function assertionOperand(value: unknown) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return "other";
}
function assertionEvidence(error: object): z.infer<typeof assertionSchema> {
  const generatedMessage = diagnosticProperty(error, "generatedMessage"),
    stack = diagnosticProperty(error, "stack");
  // These sites are for the pinned Miniflare 5.20261001.0-alpha only. A source
  // contract test requires review on upgrades. Never retain stack/path/line,
  // arbitrary operands (including RPC reference IDs), or assertion messages.
  const frames = typeof stack === "string" ? stack.slice(0, 16384).split("\n").slice(0, 64) : [];
  const at = (method: string, line: number) =>
    frames.some(
      (frame) =>
        frame.includes(method) &&
        frame.replaceAll("\\", "/").includes(`/miniflare/dist/src/index.js:${line}:`),
    );
  return {
    generatedMessage: typeof generatedMessage === "boolean" ? generatedMessage : null,
    operator: diagnosticProperty(error, "operator") === "==" ? "==" : null,
    actual: assertionOperand(diagnosticProperty(error, "actual")),
    expected: assertionOperand(diagnosticProperty(error, "expected")),
    sites: {
      asyncClientStatus: at("#parseAsyncResponse", 110451),
      asyncResultType: at("#parseAsyncResponse", 110459),
      syncClientStatus: at("#parseSyncResponse", 110483),
      responseStatus: at("#maybeThrow", 110445),
      syncReplyIdentity: at("receiveReply", 110076),
    },
  };
}

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
  const chain: z.infer<typeof chainSchema> = [];
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
        name: names.find((allowed) => allowed === name) ?? "unknown",
        code: codes.find((allowed) => allowed === code) ?? null,
        category: dependencyCategory(error),
        knownFailure: knownMessages.find((allowed) => allowed === message) ?? null,
        ...(name === "AssertionError" && code === "ERR_ASSERTION"
          ? { assertion: assertionEvidence(error) }
          : {}),
      });
      error = "cause" in error ? error.cause : null;
    } catch {
      break;
    }
  }
  return chain;
}
