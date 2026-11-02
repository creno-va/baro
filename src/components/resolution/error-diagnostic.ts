import type { ApiErrorView } from "@baro/client-core";

const codes = [
  "UNAUTHENTICATED",
  "CONSENT_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "QUOTA_EXCEEDED",
  "VALIDATION_ERROR",
  "FILE_REJECTED",
  "EXPORT_LIMIT_EXCEEDED",
  "EXPORT_RETRY_EXHAUSTED",
  "UNAVAILABLE",
] as const satisfies readonly ApiErrorView["code"][];

export type ResolutionErrorDiagnostic = Readonly<{
  code: ApiErrorView["code"] | "unknown";
  httpStatus: number | "none";
  transport: "timeout" | "abort" | "unknown";
}>;

function field(error: unknown, key: "code" | "httpStatus" | "name" | "transportFailure"): unknown {
  try {
    return error !== null && (typeof error === "object" || typeof error === "function")
      ? (error as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/** Finite DOM metadata only. Never retain messages, raw names, payloads or causes. */
export function resolutionErrorDiagnostic(error: unknown): ResolutionErrorDiagnostic {
  const code = field(error, "code");
  const status = field(error, "httpStatus");
  const name = field(error, "name");
  const transport = field(error, "transportFailure");
  return {
    code: codes.find((allowed) => allowed === code) ?? "unknown",
    httpStatus:
      typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : "none",
    transport:
      transport === "timeout" || transport === "abort" || transport === "unknown"
        ? transport
        : name === "TimeoutError"
          ? "timeout"
          : name === "AbortError"
            ? "abort"
            : "unknown",
  };
}
