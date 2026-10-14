import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseChecks } from "../scripts/release-candidate";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";

const policies: Record<string, string> = {
  "TERMS.DRAFT.md": CURRENT_POLICY_VERSIONS.termsVersion,
  "PRIVACY-POLICY.DRAFT.md": CURRENT_POLICY_VERSIONS.privacyVersion,
  "AI-NOTICE.md": CURRENT_POLICY_VERSIONS.aiNoticeVersion,
};
const approved = () =>
  Object.fromEntries(
    Object.entries(policies).map(([name, version]) => [
      name,
      `- Status: Approved for publication\n- Version: ${version}\nSynthetic test only.\n`,
    ]),
  );

// Synthetic inputs exercise the CLI's document gate, not real policy approval or live evidence.
async function runGate(documents: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "baro-release-policy-"));
  try {
    await mkdir(join(root, "docs/policies"), { recursive: true });
    await mkdir(join(root, "docs/quality"), { recursive: true });
    await Promise.all(
      Object.entries(documents).map(([name, content]) =>
        writeFile(join(root, "docs/policies", name), content),
      ),
    );
    await writeFile(
      join(root, "docs/quality/release-evidence.json"),
      JSON.stringify({
        reviewedAt: "2026-10-13T00:00:00Z",
        checks: Object.fromEntries(
          releaseChecks.map((check) => [
            check,
            { passed: true, evidenceUrl: "https://example.test/synthetic-policy-test" },
          ]),
        ),
      }),
    );
    const child = Bun.spawn(
      [process.execPath, fileURLToPath(new URL("../scripts/check-release.ts", import.meta.url))],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        // The policy fixture deliberately has no candidate or live credentials.
        // A manual validation workflow supplies these for its own release only.
        env: { ...process.env, TARGET_SHA: undefined, GITHUB_TOKEN: undefined },
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("approved version-matched policy documents alone cannot grant a public release", async () => {
  const result = await runGate(approved());
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("A full candidate SHA is required");
});

for (const missing of Object.keys(policies)) {
  test(`release document gate rejects missing ${missing}`, async () => {
    const documents = approved();
    delete documents[missing];
    const result = await runGate(documents);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Missing required policy: ${missing}`);
    expect(result.stdout).not.toContain("gate passed");
  });
}

test("release document gate rejects an empty policy directory", async () => {
  const result = await runGate({});
  expect(result.code).toBe(1);
  for (const name of Object.keys(policies))
    expect(result.stderr).toContain(`Missing required policy: ${name}`);
});

test("an approved document with a different name cannot replace a required policy", async () => {
  const documents = approved();
  documents["OTHER.md"] = documents["TERMS.DRAFT.md"] ?? "";
  delete documents["TERMS.DRAFT.md"];
  const result = await runGate(documents);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Missing required policy: TERMS.DRAFT.md");
  expect(result.stderr).not.toContain("Policy not approved: OTHER.md");
});

test("release document gate still rejects drafts, blockers, wrong consent versions and extra unapproved policies", async () => {
  const documents = approved();
  documents["TERMS.DRAFT.md"] = "- Status: Draft\n- Version: obsolete\n";
  documents["PRIVACY-POLICY.DRAFT.md"] += "[PUBLICATION_BLOCKER: synthetic]\n";
  documents["EXTRA.md"] = "- Status: Draft\n";
  const result = await runGate(documents);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Policy not approved: TERMS.DRAFT.md");
  expect(result.stderr).toContain("Published policy/consent version mismatch: TERMS.DRAFT.md");
  expect(result.stderr).toContain("Policy not approved: PRIVACY-POLICY.DRAFT.md");
  expect(result.stderr).toContain("Policy not approved: EXTRA.md");
});
