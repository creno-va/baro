import { z } from "zod";

const releaseSchema = z.string().regex(/^[a-f0-9]{40}$/);
const migrationTagSchema = z.string().regex(/^[0-9]{4}_[a-z0-9_]+$/);
const originSchema = z.enum(["https://preview.baro.site", "https://baro.site"]);
const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const paths = ["/api/health/live", "/api/health/ready"] as const;
const backoffMs = [0, 2_000, 4_000, 8_000, 16_000, 16_000, 16_000] as const;
const deadlineMs = 90_000;
const requestTimeoutMs = 10_000;

type HealthPath = (typeof paths)[number];
type FailureReason =
  | "http"
  | "invalid-health"
  | "wrong-release"
  | "missing-correlation"
  | "request-failed"
  | "request-timeout"
  | "deadline";
export type FoundationSmokeResult =
  | { passed: true; attempts: number }
  | { passed: false; attempts: number; path: HealthPath; reason: FailureReason };

interface SmokeDependencies {
  fetch: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

/** Read-only propagation wait. Both endpoints must match one SHA and its migration baseline. */
export async function foundationSmoke(
  base: string,
  sha: string,
  expectedSchemaVersion: string,
  dependencies: Partial<SmokeDependencies> = {},
): Promise<FoundationSmokeResult> {
  const origin = originSchema.parse(base);
  const release = releaseSchema.parse(sha);
  const schemaVersion = migrationTagSchema.parse(expectedSchemaVersion);
  const network = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + deadlineMs;
  let attempts = 0;
  let failure: { path: HealthPath; reason: FailureReason } = {
    path: paths[0],
    reason: "deadline",
  };
  for (const delay of backoffMs) {
    if (delay >= deadline - now()) break;
    if (delay > 0) await sleep(delay);
    if (now() >= deadline) break;
    attempts++;
    let complete = true;
    for (const path of paths) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        failure = { path, reason: "deadline" };
        complete = false;
        break;
      }
      const signal = AbortSignal.timeout(Math.min(requestTimeoutMs, remaining));
      try {
        const response = await network(`${origin}${path}`, {
          signal,
          cache: "no-store",
          redirect: "error",
          headers: { "cache-control": "no-cache" },
        });
        if (!response.ok) failure = { path, reason: "http" };
        else {
          const body = z
            .object({
              release: releaseSchema,
              service: z.literal("baro"),
              status: z.literal(path.endsWith("ready") ? "ready" : "ok"),
              environment: z.literal(origin.includes("preview.") ? "preview" : "production"),
              ...(path.endsWith("ready") ? { schemaVersion: z.literal(schemaVersion) } : {}),
            })
            .safeParse(await response.json());
          if (!body.success) failure = { path, reason: "invalid-health" };
          else if (body.data.release !== release) failure = { path, reason: "wrong-release" };
          else if (!requestIdSchema.safeParse(response.headers.get("x-request-id")).success)
            failure = { path, reason: "missing-correlation" };
          else if (now() >= deadline) failure = { path, reason: "deadline" };
          else continue;
        }
      } catch {
        // Keep response bodies, URLs from exceptions, stack traces and credentials out of receipts.
        failure = { path, reason: signal.aborted ? "request-timeout" : "request-failed" };
      }
      complete = false;
      break;
    }
    if (complete) return { passed: true, attempts };
  }
  return { passed: false, attempts, ...failure };
}
