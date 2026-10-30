import { expect, test } from "bun:test";
import {
  currentConsentVersions,
  POLICY_REVIEW,
  POLICY_VERSION,
  policyDrafts,
} from "../src/content/policy-drafts";
import { CURRENT_POLICY_VERSIONS, consentInputSchema } from "../src/contracts/consent";

test("reviewed service policies match new consent versions without fabricating external legal or release evidence", async () => {
  expect(currentConsentVersions).toEqual(CURRENT_POLICY_VERSIONS);
  for (const path of ["TERMS.DRAFT.md", "PRIVACY-POLICY.DRAFT.md", "AI-NOTICE.md"]) {
    const text = await Bun.file(`docs/policies/${path}`).text();
    expect(text).toContain(POLICY_VERSION);
    expect(text).toContain("황은찬");
    expect(text).toContain("hechec3534@naver.com");
    expect(text).not.toMatch(/^- Status: Approved for publication$/m);
  }
  expect(
    consentInputSchema.safeParse({
      termsVersion: "2026-10-04",
      privacyVersion: "2026-10-04",
      aiNoticeVersion: "2026-10-04",
      over14Confirmed: true,
    }).success,
  ).toBe(false);
  expect(POLICY_REVIEW.scope).toBe("service-content");
  expect(POLICY_REVIEW.independentLegalReviewComplete).toBe(false);
  for (const policy of Object.values(policyDrafts)) expect(policy.title).not.toContain("초안");
  const evidence = await Bun.file("docs/quality/release-evidence.json").json();
  expect(evidence.reviewedAt).toBeNull();
  expect(evidence.checks.publishedPolicies.passed).toBe(false);
  const copy = JSON.stringify(policyDrafts);
  for (const word of [
    "Whisper",
    "Containers",
    "R2",
    "ZIP",
    "동의",
    "국가",
    "미확인",
    "자격을 확인",
    "별도",
  ])
    expect(copy).toContain(word);
});
