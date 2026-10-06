import { expect, test } from "bun:test";
import { verifyLaunchAuthorization } from "../scripts/verify-launch-authorization";

const sha = "a".repeat(40),
  now = Date.parse("2026-10-07T00:00:00Z");
function comment(overrides: Record<string, unknown> = {}) {
  return {
    user: { login: "hwangeunchan", type: "User" },
    issue_url: "https://api.github.com/repos/creno-va/baro/issues/71",
    body: `<!-- BARO_OPERATOR_LAUNCH\n${JSON.stringify({
      kind: "operator-public-launch",
      targetSha: sha,
      approvedAt: "2026-10-06T23:59:00Z",
      expiresAt: "2026-10-07T01:00:00Z",
      source: "direct-user-instruction",
      publicLaunchApproved: true,
      independentExternalEvidenceComplete: false,
      ...overrides,
    })}\n-->`,
  };
}
test("explicit launch authorization is scoped to an immutable SHA and bounded time", () => {
  expect(verifyLaunchAuthorization(comment(), sha, now)).toBe(true);
  expect(verifyLaunchAuthorization(comment(), "b".repeat(40), now)).toBe(false);
  expect(verifyLaunchAuthorization(comment(), sha, Number.NaN)).toBe(false);
  for (const data of [
    { publicLaunchApproved: false },
    { independentExternalEvidenceComplete: true },
    { approvedAt: "2026-10-07T00:01:00Z" },
    { expiresAt: "2026-10-07T00:00:00Z" },
    { expiresAt: "2026-10-09T00:00:00Z" },
    { source: "automated-test" },
    { unknown: true },
  ])
    expect(verifyLaunchAuthorization(comment(data), sha, now)).toBe(false);
});
test("untrusted authors, other issues and malformed receipts cannot authorize launch", () => {
  for (const value of [
    null,
    {},
    { ...comment(), user: { login: "other", type: "User" } },
    { ...comment(), user: { login: "hwangeunchan", type: "Bot" } },
    { ...comment(), issue_url: "https://api.github.com/repos/creno-va/baro/issues/27" },
    { ...comment(), body: "approved" },
    { ...comment(), body: "<!-- BARO_OPERATOR_LAUNCH\n{}\n-->" },
  ])
    expect(verifyLaunchAuthorization(value, sha, now)).toBe(false);
});
