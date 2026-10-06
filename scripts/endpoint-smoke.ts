import { z } from "zod";
import { selfDirectoryPageSchema } from "../src/server/modules/lawyers/self-profile-contract";

const originSchema = z.enum(["https://preview.baro.site", "https://baro.site"]);
const modeSchema = z.enum(["open", "foundation"]);
const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const anonymousSessionSchema = z.strictObject({ user: z.null(), needsConsent: z.literal(false) });
const errorSchema = (code: "UNAUTHENTICATED" | "BETA_NOT_OPEN") =>
  z.object({ error: z.object({ code: z.literal(code) }) });
const protectedPaths = [
  "/api/me/consent",
  "/api/cases",
  "/api/v2/cases",
  "/api/v2/me/usage",
  "/api/v2/me/lawyer/self-profile",
  "/api/v2/cases/deployment-smoke/files",
  "/api/v2/cases/deployment-smoke/reports",
] as const;
const endpoints = [
  { path: "/api/me/session", status: 200, schema: anonymousSessionSchema },
  {
    path: "/api/v2/lawyers/self-service?limit=1",
    status: 200,
    schema: selfDirectoryPageSchema,
  },
  ...protectedPaths.map((path) => ({ path, status: 401, schema: errorSchema("UNAUTHENTICATED") })),
] as const;

export type EndpointSmokeMode = z.infer<typeof modeSchema>;
type EndpointPath = (typeof endpoints)[number]["path"];
type FailureReason =
  | "http"
  | "invalid-response"
  | "missing-no-store"
  | "missing-correlation"
  | "request-failed"
  | "request-timeout";
export type EndpointSmokeResult =
  | { passed: true; checked: number }
  | { passed: false; path: EndpointPath; reason: FailureReason };

/** Anonymous GETs only: never create sessions, cases, jobs, provider calls, or synthetic users. */
export async function endpointSmoke(
  base: string,
  mode: EndpointSmokeMode,
  dependencies: { fetch?: typeof fetch } = {},
): Promise<EndpointSmokeResult> {
  const origin = originSchema.parse(base);
  const expectedMode = modeSchema.parse(mode);
  const network = dependencies.fetch ?? fetch;
  for (const endpoint of endpoints) {
    const signal = AbortSignal.timeout(10_000);
    const failure = (reason: FailureReason): EndpointSmokeResult => ({
      passed: false,
      path: endpoint.path,
      reason,
    });
    try {
      const response = await network(`${origin}${endpoint.path}`, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: { "cache-control": "no-cache" },
      });
      const status = expectedMode === "foundation" ? 503 : endpoint.status;
      const schema = expectedMode === "foundation" ? errorSchema("BETA_NOT_OPEN") : endpoint.schema;
      if (response.status !== status) return failure("http");
      if (
        !response.headers
          .get("cache-control")
          ?.split(/\s*,\s*/)
          .includes("no-store")
      )
        return failure("missing-no-store");
      if (!requestIdSchema.safeParse(response.headers.get("x-request-id")).success)
        return failure("missing-correlation");
      const body: unknown = await response.json().catch(() => undefined);
      if (!schema.safeParse(body).success) return failure("invalid-response");
    } catch {
      // Receipts contain only fixed paths/reasons, never responses, exception URLs, or credentials.
      return failure(signal.aborted ? "request-timeout" : "request-failed");
    }
  }
  return { passed: true, checked: endpoints.length };
}
