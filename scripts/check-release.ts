import { readdir } from "node:fs/promises";
import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";

const required = [
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
const evidence = z
  .object({
    reviewedAt: z.iso.datetime().nullable(),
    checks: z.record(
      z.string(),
      z.object({ passed: z.boolean(), evidenceUrl: z.url().nullable() }),
    ),
  })
  .parse(await Bun.file("docs/quality/release-evidence.json").json());
const errors: string[] = [];
const policyVersions: Record<string, string> = {
  "TERMS.DRAFT.md": CURRENT_POLICY_VERSIONS.termsVersion,
  "PRIVACY-POLICY.DRAFT.md": CURRENT_POLICY_VERSIONS.privacyVersion,
  "AI-NOTICE.md": CURRENT_POLICY_VERSIONS.aiNoticeVersion,
};
for (const file of (await readdir("docs/policies")).filter((name) => name.endsWith(".md"))) {
  const content = await Bun.file(`docs/policies/${file}`).text();
  if (
    content.includes("[PUBLICATION_BLOCKER:") ||
    !/^- Status: Approved for publication$/m.test(content.replaceAll("\r", ""))
  ) {
    errors.push(`Policy not approved: ${file}`);
  }
  if (
    policyVersions[file] &&
    content.match(/^- (?:문서 버전|Version): (.+)$/m)?.[1]?.trim() !== policyVersions[file]
  ) {
    errors.push(`Published policy/consent version mismatch: ${file}`);
  }
}
for (const check of required) {
  if (!evidence.checks[check]?.passed || !evidence.checks[check]?.evidenceUrl)
    errors.push(`Missing release evidence: ${check}`);
}
if (!evidence.reviewedAt) errors.push("Release evidence is not reviewed");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Public beta publication/evidence gate passed; production approval still applies.");
