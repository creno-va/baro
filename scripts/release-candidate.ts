import { z } from "zod";

// Independent #19 contract preparation. The production release checker is not wired to it yet.
// A receipt resolver must verify CI/platform artifacts; manually constructed booleans are not receipts.
export const releaseChecks = [
  "oauth",
  "turnstile",
  "gateway",
  "legalApi",
  "aiEval",
  "deletionRace",
  "accessibility",
  "restoreRollback",
  "alerts",
  "publishedPolicies",
] as const;
const sha = z.string().regex(/^[a-f0-9]{40}$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const mode = z.enum([
  "live-preview",
  "deterministic-ui",
  "isolated-platform-drill",
  "human-policy-review",
]);
const evidence = z.strictObject({
  check: z.enum(releaseChecks),
  candidateSha: sha,
  environment: z.enum(["preview", "isolated-test"]),
  mode,
  result: z.literal("pass"),
  runId: z.number().int().positive(),
  artifactHash: hash,
});
export const releaseCandidateSchema = z.strictObject({
  candidateSha: sha,
  evidence: z.array(evidence).length(releaseChecks.length),
});
export interface VerifiedReceipt {
  candidateSha: string;
  environment: "preview" | "isolated-test";
  mode: z.infer<typeof mode>;
  conclusion: "success" | "failure";
  completed: boolean;
  artifactHash: string;
  checks: readonly (typeof releaseChecks)[number][];
  criticalFindings: number;
}
/** Resolver is a trusted boundary, implemented only after #27. Never trust document fields alone. */
export async function validateReleaseCandidate(
  input: unknown,
  targetSha: string,
  resolveReceipt: (runId: number) => Promise<VerifiedReceipt>,
) {
  sha.parse(targetSha);
  const candidate = releaseCandidateSchema.parse(input);
  if (candidate.candidateSha !== targetSha) throw new Error("CANDIDATE_MISMATCH");
  if (new Set(candidate.evidence.map((e) => e.check)).size !== releaseChecks.length)
    throw new Error("MISSING_RELEASE_CHECK");
  for (const e of candidate.evidence) {
    const requiredMode =
      e.check === "publishedPolicies"
        ? "human-policy-review"
        : e.check === "accessibility"
          ? "deterministic-ui"
          : ["restoreRollback", "alerts"].includes(e.check)
            ? "isolated-platform-drill"
            : "live-preview";
    if (
      e.candidateSha !== targetSha ||
      e.mode !== requiredMode ||
      (requiredMode === "isolated-platform-drill") !== (e.environment === "isolated-test")
    )
      throw new Error("EVIDENCE_SCOPE_MISMATCH");
    let receipt: VerifiedReceipt;
    try {
      receipt = await resolveReceipt(e.runId);
    } catch {
      throw new Error("RECEIPT_UNAVAILABLE");
    }
    if (
      !receipt.completed ||
      receipt.conclusion !== "success" ||
      receipt.candidateSha !== targetSha ||
      receipt.mode !== e.mode ||
      receipt.environment !== e.environment ||
      receipt.artifactHash !== e.artifactHash ||
      !receipt.checks.includes(e.check) ||
      receipt.criticalFindings !== 0
    )
      throw new Error("UNVERIFIED_RELEASE_RECEIPT");
  }
  return {
    candidateSha: targetSha,
    checks: releaseChecks,
    runUrls: [
      ...new Set(
        candidate.evidence.map((e) => `https://github.com/creno-va/baro/actions/runs/${e.runId}`),
      ),
    ],
  };
}
