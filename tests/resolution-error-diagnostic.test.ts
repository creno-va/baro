import { expect, test } from "bun:test";
import { responseError } from "@baro/api-client";
import { resolutionErrorDiagnostic } from "../src/components/resolution/error-diagnostic";

const sentinel = "SYNTHETIC-DIAGNOSTIC-PRIVATE";

test.each([
  [409, "STALE_REVISION", "CONFLICT"],
  [409, "POLICY_REJECTED", "CONFLICT"],
  [503, "DEPENDENCY_UNAVAILABLE", "UNAVAILABLE"],
] as const)(
  "real responseError preserves only finite code/status for HTTP %i %s",
  async (status, code, normalized) => {
    const error = await responseError(
      new Response(
        JSON.stringify({
          error: { code, message: sentinel, body: sentinel, token: sentinel, url: sentinel },
        }),
        { status },
      ),
    );
    expect(resolutionErrorDiagnostic(error)).toEqual({
      code: normalized,
      httpStatus: status,
      transport: "unknown",
    });
  },
);

test("only normalized codes and integer HTTP statuses are retained", () => {
  for (const code of [
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
  ] as const)
    expect(resolutionErrorDiagnostic({ code }).code).toBe(code);
  for (const code of [sentinel, "STALE_REVISION", 409, null, { toString: () => sentinel }])
    expect(resolutionErrorDiagnostic({ code }).code).toBe("unknown");
  for (const httpStatus of [100, 200, 409, 503, 599])
    expect(resolutionErrorDiagnostic({ httpStatus }).httpStatus).toBe(httpStatus);
  for (const httpStatus of [
    99,
    600,
    409.5,
    NaN,
    Infinity,
    "503",
    null,
    true,
    { valueOf: () => 503 },
  ])
    expect(resolutionErrorDiagnostic({ httpStatus }).httpStatus).toBe("none");
});

test("transport classification uses only exact top-level names and never raw sensitive fields", () => {
  for (const [name, transport] of [
    ["TimeoutError", "timeout"],
    ["AbortError", "abort"],
    [sentinel, "unknown"],
    ["TimeoutError secret", "unknown"],
    ["TypeError", "unknown"],
  ] as const) {
    const error = {
      code: sentinel,
      httpStatus: sentinel,
      name,
      message: sentinel,
      body: sentinel,
      stack: sentinel,
      url: sentinel,
      ids: [sentinel],
      token: sentinel,
      cause: new DOMException(sentinel, "TimeoutError"),
      toJSON: () => {
        throw Error(sentinel);
      },
    };
    const diagnostic = resolutionErrorDiagnostic(error);
    expect(diagnostic).toEqual({ code: "unknown", httpStatus: "none", transport });
    expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  }
  expect(resolutionErrorDiagnostic(new DOMException(sentinel, "AbortError"))).toEqual({
    code: "unknown",
    httpStatus: "none",
    transport: "abort",
  });
});

test("primitives and throwing getters cannot expose a diagnostic payload or throw", () => {
  for (const error of [
    undefined,
    null,
    sentinel,
    503,
    Object.defineProperties(
      {},
      Object.fromEntries(
        ["code", "httpStatus", "name", "transportFailure"].map((key) => [
          key,
          {
            get() {
              throw Error(sentinel);
            },
          },
        ]),
      ),
    ),
  ])
    expect(resolutionErrorDiagnostic(error)).toEqual({
      code: "unknown",
      httpStatus: "none",
      transport: "unknown",
    });
});

test("only finite transportFailure metadata takes precedence over exact names", () => {
  for (const transportFailure of ["timeout", "abort", "unknown"] as const)
    expect(resolutionErrorDiagnostic({ transportFailure, name: "TimeoutError" }).transport).toBe(
      transportFailure,
    );
  for (const transportFailure of [sentinel, null, false, { toString: () => sentinel }]) {
    expect(resolutionErrorDiagnostic({ transportFailure, name: "TimeoutError" }).transport).toBe(
      "timeout",
    );
    const diagnostic = resolutionErrorDiagnostic({ transportFailure });
    expect(diagnostic.transport).toBe("unknown");
    expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  }
});
