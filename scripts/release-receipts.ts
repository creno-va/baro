import { z } from "zod";
import { releaseChecks, type VerifiedReceipt } from "./release-candidate";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const runSchema = z.object({
  id: z.number().int().positive(),
  head_branch: z.literal("main"),
  event: z.literal("workflow_dispatch"),
  status: z.literal("completed"),
  conclusion: z.literal("success"),
  path: z.string(),
  repository: z.object({ full_name: z.literal("creno-va/baro") }),
});
const artifactSchema = z.object({
  name: z.string(),
  expired: z.literal(false),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  workflow_run: z.object({ id: z.number().int().positive() }),
});

/** The allowlist identifies producers whose successful jobs actually perform
 * the declared check. Metadata inspections and deterministic evals cannot stand
 * in for OAuth, paid model execution, recovery or human policy approval.
 * Add producers only with their own result/negative-case contract tests. */
const producers = {
  accessibility: {
    path: ".github/workflows/full-validation.yml",
    job: "Full validation",
    step: "Run explicit full validation",
    receiptStep: "Record actual tested candidate",
    environment: "preview",
    mode: "deterministic-ui",
  },
} as const;

/** GitHub v4 artifact digest is the immutable archive hash. Its name is emitted
 * only after a trusted producer verifies the actual checkout. Run success alone
 * or an arbitrary user-provided URL/boolean never grants a check. */
export function githubReceiptResolver(get: (path: string) => Promise<unknown>) {
  const cache = new Map<number, Promise<VerifiedReceipt>>();
  return (runId: number): Promise<VerifiedReceipt> => {
    const old = cache.get(runId);
    if (old) return old;
    const resolve = async (): Promise<VerifiedReceipt> => {
      const run = runSchema.parse(await get(`actions/runs/${runId}`));
      if (run.id !== runId) throw new Error("RECEIPT_RUN_MISMATCH");
      const artifacts = z
        .object({ artifacts: z.array(z.unknown()), total_count: z.number() })
        .parse(await get(`actions/runs/${runId}/artifacts?per_page=100`));
      if (artifacts.total_count > 100) throw new Error("RECEIPT_ARTIFACT_OVERFLOW");
      const jobs = z
        .object({
          jobs: z.array(
            z.object({
              name: z.string(),
              conclusion: z.string().nullable(),
              steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })),
            }),
          ),
          total_count: z.number(),
        })
        .parse(await get(`actions/runs/${runId}/jobs?filter=latest&per_page=100`));
      if (jobs.total_count > 100) throw new Error("RECEIPT_JOB_OVERFLOW");
      for (const [check, producer] of Object.entries(producers)) {
        if (run.path !== producer.path) continue;
        const job = jobs.jobs.find((j) => j.name === producer.job && j.conclusion === "success");
        if (
          !job ||
          ![producer.step, producer.receiptStep].every((name) =>
            job.steps.some((s) => s.name === name && s.conclusion === "success"),
          )
        )
          continue;
        const prefix = `release-${check}-${producer.environment}-`;
        const matching = artifacts.artifacts.flatMap((raw) => {
          const item = artifactSchema.safeParse(raw);
          return item.success &&
            item.data.workflow_run.id === runId &&
            item.data.name.startsWith(prefix)
            ? [item.data]
            : [];
        });
        if (matching.length !== 1) throw new Error("RECEIPT_ARTIFACT_MISSING");
        const artifact = matching[0];
        if (!artifact) throw new Error("RECEIPT_ARTIFACT_MISSING");
        const candidateSha = artifact.name.slice(prefix.length);
        if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("RECEIPT_CANDIDATE_INVALID");
        return {
          candidateSha,
          environment: producer.environment,
          mode: producer.mode,
          conclusion: "success",
          completed: true,
          artifactHash: hash.parse(artifact.digest.slice(7)),
          checks: [z.enum(releaseChecks).parse(check)],
          criticalFindings: 0,
        };
      }
      throw new Error("RECEIPT_PRODUCER_UNSUPPORTED");
    };
    const pending = resolve();
    cache.set(runId, pending);
    return pending;
  };
}

export function githubReleaseGet(token: string, fetcher: typeof fetch = fetch) {
  return async (path: string): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/creno-va/baro/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("RELEASE_EVIDENCE_UNAVAILABLE");
    return response.json();
  };
}
