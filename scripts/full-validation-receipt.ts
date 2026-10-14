import { mkdir } from "node:fs/promises";

// Invoked only after validate:full succeeds. Git is the source of tested SHA;
// github.sha may instead identify the workflow dispatcher revision.
if (import.meta.main) {
  const sha = (await new Response(Bun.spawn(["git", "rev-parse", "HEAD"]).stdout).text()).trim();
  if (!/^[a-f0-9]{40}$/.test(sha) || sha !== process.env.TARGET_SHA)
    throw new Error("FULL_VALIDATION_CHECKOUT_MISMATCH");
  await mkdir(".wrangler/release", { recursive: true });
  await Bun.write(
    ".wrangler/release/full-validation.json",
    JSON.stringify({
      candidateSha: sha,
      environment: "preview",
      mode: "deterministic-ui",
      result: "pass",
      check: "accessibility",
      fullValidation: true,
      runId: process.env.GITHUB_RUN_ID,
      paidExternalCalls: false,
      independentExternalEvidenceComplete: false,
    }),
  );
}
