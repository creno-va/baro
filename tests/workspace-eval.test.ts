import { expect, test } from "bun:test";
import { evaluationCandidate } from "../scripts/eval-workspace";
import { workspaceScenarios } from "../scripts/workspace-eval/corpus";
import {
  completion,
  evaluateWorkspace,
  evaluationPlan,
  humanChecks,
  type Replay,
} from "../scripts/workspace-eval/runner";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";

const sha = "a".repeat(40);
const baseline = await evaluateWorkspace(sha);
function required<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error("TEST_ITEM_MISSING");
  return item;
}
function requiredReview(replay: Replay) {
  const review = required(replay.scenarios).humanReview;
  if (!review) throw new Error("TEST_REVIEW_MISSING");
  return review;
}
function trace(): Replay {
  return structuredClone(baseline.replay) as Replay;
}
function reviewed(): Replay {
  const replay = trace();
  for (const s of replay.scenarios)
    s.humanReview = {
      reviewer: "synthetic-reviewer",
      checks: humanChecks.map((check) => ({ check, result: "pass" })),
    };
  return replay;
}
async function replaceDraft(replay: Replay, id: string, output: unknown) {
  const s = workspaceScenarios.find((s) => s.id === id);
  const r = replay.scenarios.find((s) => s.id === id);
  if (!s || !r || r.calls.length !== 2) throw new Error("TEST_TRACE_MISSING");
  required(r.calls).response = completion(output);
  required(r.calls, 1).wireInputSha256 = (
    await gatewayWireIdentity(
      prepareGatewayWireInput("workspace_audit", {
        phase: s.phase,
        context: s.context,
        draft: output,
      }),
    )
  ).wireInputSha256;
}
test("current v2 corpus runs actual gateway/schema/pipeline, covers every critical scope and never declares live completion", () => {
  expect(baseline.report.scenarios).toHaveLength(56);
  expect(baseline.report.deterministicCritical).toBe(0);
  expect(baseline.report.policy).toEqual({ followupRounds: 2, questionsPerBatch: 3 });
  expect(baseline.report.mode).toBe("scripted-v2-pipeline");
  expect(baseline.report.missingHumanReviews).toBe(56);
  expect(baseline.report.liveExecutionVerified).toBe(false);
  expect(baseline.report.closureReady).toBe(false);
  for (const id of ["questions-round-cap", "chat-reconfirmation-required"]) {
    expect(baseline.report.scenarios.find((s) => s.id === id)).toMatchObject({
      outcome: "blocked",
      calls: 0,
      critical: [],
    });
  }
});
test("synthetic plan exports current contexts and expectations without scripted answers or provider calls", async () => {
  const plan = await evaluationPlan(sha);
  expect(plan.scenarios).toHaveLength(56);
  expect(plan.corpusSha256).toBe(baseline.report.corpusSha256);
  expect(plan.gatewayContractSha256).toBe(baseline.report.gatewayContractSha256);
  expect(plan.scenarios.some((s) => "scripted" in s)).toBe(false);
});
test("exact captured responses reproduce deterministic results without promoting submitted human verdicts to trusted live evidence", async () => {
  const result = await evaluateWorkspace(sha, reviewed());
  expect(result.report.deterministicCritical).toBe(0);
  expect(result.report.reportedHumanCritical).toBe(0);
  expect(result.report.missingHumanReviews).toBe(0);
  expect(result.report.mode).toBe("captured-response-replay");
  expect(result.report.scenarios.every((s) => s.humanReview === "reported-unverified")).toBe(true);
  expect(result.report.closureReady).toBe(false);
  expect(result.report.liveExecutionVerified).toBe(false);
});
test.each(["candidateSha", "corpusSha256", "gatewayContractSha256"] as const)(
  "receipt scope mismatch rejects %s",
  async (field) => {
    const replay = trace();
    replay[field] = "b".repeat(field === "candidateSha" ? 40 : 64);
    await expect(evaluateWorkspace(sha, replay)).rejects.toThrow("EVAL_CANDIDATE_MISMATCH");
  },
);
test.each(["missing", "duplicate", "unknown"] as const)(
  "corpus coverage rejects %s scenario",
  async (mode) => {
    const replay = trace();
    if (mode === "missing") replay.scenarios.pop();
    else if (mode === "duplicate")
      replay.scenarios[0] = structuredClone(required(replay.scenarios, 1));
    else required(replay.scenarios).id = "unrelated-scenario";
    await expect(evaluateWorkspace(sha, replay)).rejects.toThrow();
  },
);
test.each(["digest", "missing-call", "extra-call", "blocked-call"] as const)(
  "wire receipt rejects %s",
  async (mode) => {
    const replay = trace();
    if (mode === "digest")
      required(required(replay.scenarios).calls).wireInputSha256 = "0".repeat(64);
    if (mode === "missing-call") required(replay.scenarios).calls.pop();
    if (mode === "extra-call")
      required(replay.scenarios).calls.push(
        structuredClone(required(required(replay.scenarios).calls)),
      );
    if (mode === "blocked-call")
      required(replay.scenarios, 2).calls.push(
        structuredClone(required(required(replay.scenarios).calls)),
      );
    await expect(evaluateWorkspace(sha, replay)).rejects.toThrow("EVAL_REPLAY_INPUT_MISMATCH");
  },
);
test("a valid schema and passing model audit cannot hide dropped unfavorable facts or unknowns", async () => {
  const id = "summary-attribution-unknown-unfavorable";
  const replay = trace();
  const s = workspaceScenarios.find((s) => s.id === id);
  await replaceDraft(replay, id, { ...(s?.scripted as object), facts: [], unknowns: [] });
  const result = await evaluateWorkspace(sha, replay);
  expect(result.report.scenarios.find((s) => s.id === id)?.critical).toEqual([
    "required_fact_not_preserved",
    "unknowns_not_preserved",
  ]);
  expect(result.report.deterministicCritical).toBe(2);
});
test("safe generic chat text still fails when it drops the requested lawyer handoff", async () => {
  const replay = trace(),
    id = "chat-strategy-injection-handoff";
  const s = workspaceScenarios.find((s) => s.id === id);
  await replaceDraft(replay, id, { ...(s?.scripted as object), text: "내용을 정리해 주세요." });
  const result = await evaluateWorkspace(sha, replay);
  expect(result.report.scenarios.find((s) => s.id === id)?.critical).toContain(
    "strategy_handoff_missing",
  );
});
test("missing human review stays missing and one critical human finding cannot be averaged away", async () => {
  const missing = await evaluateWorkspace(sha, trace());
  expect(missing.report.missingHumanReviews).toBe(56);
  const replay = reviewed();
  required(requiredReview(replay).checks).result = "critical";
  const result = await evaluateWorkspace(sha, replay);
  expect(result.report.reportedHumanCritical).toBe(1);
  expect(required(result.report.scenarios).humanCritical).toEqual(["facts"]);
});
test("duplicate review dimensions and live success claims are rejected", async () => {
  const replay = reviewed();
  required(requiredReview(replay).checks, 1).check = "facts";
  await expect(evaluateWorkspace(sha, replay)).rejects.toThrow();
  await expect(
    evaluateWorkspace(sha, { ...trace(), liveExecutionVerified: true }),
  ).rejects.toThrow();
  await expect(evaluateWorkspace(sha, { ...trace(), mode: "live-preview" })).rejects.toThrow();
});
test("provider refusal does not become a successful published case or a schema repair", async () => {
  const replay = trace();
  required(replay.scenarios).calls = [
    {
      ...required(required(replay.scenarios).calls),
      response: {
        choices: [
          {
            message: { content: null, refusal: "synthetic private sentinel" },
            finish_reason: "stop",
          },
        ],
      },
    },
  ];
  const result = await evaluateWorkspace(sha, replay);
  expect(result.report.scenarios[0]).toMatchObject({
    outcome: "failed",
    calls: 1,
    critical: ["POLICY_REJECTED"],
  });
  expect(JSON.stringify(result.report)).not.toContain("sentinel");
});
test("saved reports contain no case text, provider response, reviewer identity or private transport data", async () => {
  const result = await evaluateWorkspace(sha, reviewed());
  const text = JSON.stringify(result.report);
  expect(text).not.toContain(required(workspaceScenarios).context.intake.narrative);
  expect(text).not.toContain("synthetic-reviewer");
  expect(text).not.toContain("choices");
  expect(text).not.toContain("wireInputSha256");
});

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "scripts/eval-workspace.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  return { code: await child.exited, stdout, stderr };
}
test("CLI refuses incomplete captured evaluation and emits a safe failure report for invalid evidence", async () => {
  const git = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const actual = (await new Response(git.stdout).text()).trim();
  expect(await git.exited).toBe(0);
  const { replay } = await evaluateWorkspace(actual);
  const path = `.wrangler/eval/test-replay-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify(replay));
  const missing = await cli(["--replay", path]);
  expect(missing.code).toBe(1);
  const status = Bun.spawn(["git", "status", "--porcelain", "--untracked-files=normal"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const dirty = (await new Response(status.stdout).text()).trim();
  expect(await status.exited).toBe(0);
  if (dirty) expect(missing.stderr).toContain("V2 evaluation failed");
  else expect(missing.stdout).toContain("56 missing reviews");
  const invalid = await cli(["--replay", `${path}-private-sentinel`]);
  expect(invalid.code).toBe(1);
  expect(invalid.stderr).not.toContain("private-sentinel");
  expect(invalid.stderr).not.toContain("Error:");
  expect(await Bun.file(".wrangler/eval/workspace-v2-replay.json").json()).toMatchObject({
    status: "failed",
    closureReady: false,
  });
});

test("uncommitted or untracked source cannot be attributed to the clean candidate SHA", () => {
  expect(evaluationCandidate(sha, "")).toBe(sha);
  expect(evaluationCandidate(sha, " M src/server/runtime/workspace.ts")).toBe("local");
  expect(evaluationCandidate(sha, "?? scripts/eval-workspace.ts")).toBe("local");
  expect(() => evaluationCandidate("invented", "")).toThrow("EVAL_CHECKOUT_UNAVAILABLE");
});
