import { expect, test } from "bun:test";
import {
  releaseChecks,
  type VerifiedReceipt,
  validateReleaseCandidate,
} from "../scripts/release-candidate";

const target = "a".repeat(40),
  old = "b".repeat(40);
function fixture() {
  const evidence = releaseChecks.map((check, i) => ({
    check,
    candidateSha: target,
    environment: ["restoreRollback", "alerts"].includes(check)
      ? ("isolated-test" as const)
      : ("preview" as const),
    mode:
      check === "publishedPolicies"
        ? ("human-policy-review" as const)
        : check === "accessibility"
          ? ("deterministic-ui" as const)
          : ["restoreRollback", "alerts"].includes(check)
            ? ("isolated-platform-drill" as const)
            : ("live-preview" as const),
    result: "pass" as const,
    runId: i + 1,
    artifactHash: "c".repeat(64),
  }));
  const resolve = async (runId: number): Promise<VerifiedReceipt> => {
    const e = evidence[runId - 1];
    if (!e) throw new Error();
    return { ...e, checks: [e.check], completed: true, conclusion: "success", criticalFindings: 0 };
  };
  return { candidate: { candidateSha: target, evidence }, resolve };
}
test("candidate contract rejects legacy booleans, old SHA, duplicated gates and deterministic evidence for live model", async () => {
  const f = fixture();
  await expect(
    validateReleaseCandidate(
      {
        reviewedAt: new Date().toISOString(),
        checks: { aiEval: { passed: true, evidenceUrl: "https://example.test" } },
      },
      target,
      f.resolve,
    ),
  ).rejects.toThrow();
  await expect(validateReleaseCandidate(f.candidate, old, f.resolve)).rejects.toThrow(
    "CANDIDATE_MISMATCH",
  );
  const duplicate = structuredClone(f.candidate);
  const first = duplicate.evidence[0];
  if (!first) throw new Error("fixture");
  duplicate.evidence[1] = { ...first };
  await expect(validateReleaseCandidate(duplicate, target, f.resolve)).rejects.toThrow(
    "MISSING_RELEASE_CHECK",
  );
  const fake = structuredClone(f.candidate);
  const model = fake.evidence[4];
  if (!model) throw new Error("fixture");
  model.mode = "deterministic-ui";
  await expect(validateReleaseCandidate(fake, target, f.resolve)).rejects.toThrow(
    "EVIDENCE_SCOPE_MISMATCH",
  );
});
test("candidate contract fails on one critical, failed/unfinished/old/mismatched artifact receipt or inaccessible evidence", async () => {
  const f = fixture();
  for (const override of [
    { criticalFindings: 1 },
    { completed: false },
    { conclusion: "failure" as const },
    { candidateSha: old },
    { artifactHash: "d".repeat(64) },
    { checks: [] },
  ])
    await expect(
      validateReleaseCandidate(f.candidate, target, async (id) => ({
        ...(await f.resolve(id)),
        ...override,
      })),
    ).rejects.toThrow("UNVERIFIED_RELEASE_RECEIPT");
  await expect(
    validateReleaseCandidate(f.candidate, target, async () => {
      throw new Error("private provider error");
    }),
  ).rejects.toThrow("RECEIPT_UNAVAILABLE");
  expect((await validateReleaseCandidate(f.candidate, target, f.resolve)).runUrls).toHaveLength(10);
});
