import { evaluateWorkspace, evaluationPlan } from "./workspace-eval/runner";

export function evaluationCandidate(sha: string, porcelain: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("EVAL_CHECKOUT_UNAVAILABLE");
  return porcelain.trim() ? "local" : sha;
}
async function checkoutSha() {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const sha = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error("EVAL_CHECKOUT_UNAVAILABLE");
  const status = Bun.spawn(["git", "status", "--porcelain", "--untracked-files=normal"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const porcelain = await new Response(status.stdout).text();
  if (await status.exited) throw new Error("EVAL_CHECKOUT_UNAVAILABLE");
  return evaluationCandidate(sha, porcelain);
}
export async function writeFixtureWorkspaceEvaluation(candidateSha = "local") {
  if (candidateSha !== "local" && (await checkoutSha()) !== candidateSha)
    throw new Error("EVAL_CHECKOUT_MISMATCH");
  const { report } = await evaluateWorkspace(candidateSha);
  await Bun.write(".wrangler/eval/workspace-v2.json", JSON.stringify(report, null, 2));
  console.log(
    `V2 scripted pipeline: ${report.scenarios.length} scenarios, ${report.deterministicCritical} critical findings. Live execution and human review remain unverified.`,
  );
  if (report.deterministicCritical) process.exitCode = 1;
  return report;
}
if (import.meta.main) {
  const [mode, path, ...extra] = Bun.argv.slice(2);
  try {
    if (
      extra.length ||
      (mode !== undefined && mode !== "--plan" && mode !== "--replay") ||
      (mode === "--replay") !== Boolean(path)
    )
      throw new Error("EVAL_USAGE");
    const sha = await checkoutSha();
    if (!mode) await writeFixtureWorkspaceEvaluation(sha);
    else if (mode === "--plan") {
      await Bun.write(
        ".wrangler/eval/workspace-v2-plan.json",
        JSON.stringify(await evaluationPlan(sha), null, 2),
      );
      console.log("Synthetic v2 evaluation plan exported. No model or remote service was called.");
    } else {
      if (sha === "local") throw new Error("EVAL_CHECKOUT_DIRTY");
      const file = Bun.file(path as string);
      if (file.size > 8 * 1024 * 1024) throw new Error("EVAL_REPLAY_TOO_LARGE");
      const { report } = await evaluateWorkspace(sha, await file.json());
      await Bun.write(".wrangler/eval/workspace-v2-replay.json", JSON.stringify(report, null, 2));
      console.log(
        `V2 captured response replay: ${report.deterministicCritical} deterministic / ${report.reportedHumanCritical} reported human critical findings; ${report.missingHumanReviews} missing reviews. Live execution remains unverified.`,
      );
      if (
        report.deterministicCritical ||
        report.reportedHumanCritical ||
        report.missingHumanReviews
      )
        process.exitCode = 1;
    }
  } catch {
    if (mode === "--replay") {
      await Bun.write(
        ".wrangler/eval/workspace-v2-replay.json",
        JSON.stringify(
          {
            mode: "captured-response-replay",
            status: "failed",
            liveExecutionVerified: false,
            closureReady: false,
          },
          null,
          2,
        ),
      );
    }
    // Never print captured model responses, local paths, private fields or error stacks.
    console.error(
      "V2 evaluation failed: invalid command, checkout, evidence or replay. Usage: bun scripts/eval-workspace.ts [--plan | --replay FILE]",
    );
    process.exitCode = 1;
  }
}
