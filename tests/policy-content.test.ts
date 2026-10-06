import { expect, test } from "bun:test";
import {
  currentConsentVersions,
  POLICY_DRAFT_VERSION,
  policyDrafts,
} from "../src/content/policy-drafts";
import { CURRENT_POLICY_VERSIONS, consentInputSchema } from "../src/contracts/consent";

test("v2 draft documents and screens keep the existing consent version distinct and cannot authorize publication", async () => {
  expect(currentConsentVersions).toEqual(CURRENT_POLICY_VERSIONS);
  for (const path of ["TERMS.DRAFT.md", "PRIVACY-POLICY.DRAFT.md", "AI-NOTICE.md"]) {
    const text = await Bun.file(`docs/policies/${path}`).text();
    expect(text).toContain(POLICY_DRAFT_VERSION);
    expect(text).toContain("2026-10-04");
    expect(text).not.toMatch(/^- Status: Approved for publication$/m);
  }
  expect(
    consentInputSchema.safeParse({
      termsVersion: POLICY_DRAFT_VERSION,
      privacyVersion: POLICY_DRAFT_VERSION,
      aiNoticeVersion: POLICY_DRAFT_VERSION,
      over14Confirmed: true,
    }).success,
  ).toBe(false);
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
    "자격 확인",
    "별도",
  ])
    expect(copy).toContain(word);
});
