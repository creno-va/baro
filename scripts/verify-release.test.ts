import { expect, test } from "bun:test";
import { hasVerifiedCI, verifyRelease } from "./verify-release";

test("release CI gate rejects PR-only checks and a different SHA", () => {
  const run = { head_sha: "verified", head_branch: "main", conclusion: "success", event: "push" };
  expect(hasVerifiedCI([run], "verified")).toBe(true);
  expect(hasVerifiedCI([run], "other")).toBe(false);
  expect(hasVerifiedCI([{ ...run, event: "pull_request" }], "verified")).toBe(false);
  expect(hasVerifiedCI([{ ...run, conclusion: "failure" }], "verified")).toBe(false);
});

test("manual preview accepts CI alone but production still requires matching successful preview smoke", async () => {
  const sha = "a".repeat(40);
  const ci = {
    workflow_runs: [{ head_sha: sha, head_branch: "main", conclusion: "success", event: "push" }],
  };
  const requested: string[] = [];
  const missingPreview = async (path: string) => {
    requested.push(path);
    return path.startsWith("actions/") ? ci : [];
  };
  await verifyRelease(sha, missingPreview, true);
  expect(requested).toHaveLength(1);
  expect(verifyRelease(sha, missingPreview)).rejects.toThrow("No successful preview");
  const preview =
    (state: string, deploymentSha = sha) =>
    async (path: string) => {
      if (path.startsWith("actions/")) return ci;
      if (path.includes("/statuses")) return [{ state }, { state: "success" }];
      return [{ id: 123, sha: deploymentSha }];
    };
  await verifyRelease(sha, preview("success"));
  expect(verifyRelease(sha, preview("failure"))).rejects.toThrow("No successful preview");
  expect(verifyRelease(sha, preview("success", "b".repeat(40)))).rejects.toThrow(
    "No successful preview",
  );
  expect(verifyRelease(sha, async () => ({ workflow_runs: [] }), true)).rejects.toThrow(
    "No successful main",
  );
});
