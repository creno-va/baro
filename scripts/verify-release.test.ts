import { expect, test } from "bun:test";
import { hasVerifiedCI } from "./verify-release";

test("release CI gate rejects PR-only checks and a different SHA", () => {
  const run = { head_sha: "verified", head_branch: "main", conclusion: "success", event: "push" };
  expect(hasVerifiedCI([run], "verified")).toBe(true);
  expect(hasVerifiedCI([run], "other")).toBe(false);
  expect(hasVerifiedCI([{ ...run, event: "pull_request" }], "verified")).toBe(false);
  expect(hasVerifiedCI([{ ...run, conclusion: "failure" }], "verified")).toBe(false);
});
