import { expect, test } from "bun:test";
import { createWorkspaceProgress } from "../src/server/modules/workspace/progress";

test("stage timing keeps repeated generation and retrieval separate and marks an unfinished audit failed", async () => {
  let now = 0;
  const phases: string[] = [];
  const progress = createWorkspaceProgress(
    async (phase) => {
      phases.push(phase);
    },
    () => now,
  );
  for (const [stage, duration] of [
    ["context", 12],
    ["generation", 1500],
    ["retrieval", 210],
    ["generation", 800],
    ["audit", 400],
  ] as const) {
    await progress.enter(stage);
    now += duration;
  }
  expect(phases).toEqual(["admission", "generating", "retrieving", "generating", "validating"]);
  expect(progress.finish("failed")).toEqual([
    { stage: "context", durationMs: 12, outcome: "completed" },
    { stage: "generation", durationMs: 1500, outcome: "completed" },
    { stage: "retrieval", durationMs: 210, outcome: "completed" },
    { stage: "generation", durationMs: 800, outcome: "completed" },
    { stage: "audit", durationMs: 400, outcome: "failed" },
  ]);
  expect(progress.finish("failed")).toHaveLength(5);
});

test("a rejected checkpoint cannot claim the next stage began", async () => {
  let now = 0;
  const progress = createWorkspaceProgress(
    async (phase) => {
      if (phase === "generating") throw new Error("Synthetic stale lease");
    },
    () => now,
  );
  await progress.enter("context");
  now = 10;
  await expect(progress.enter("generation")).rejects.toThrow("Synthetic stale lease");
  expect(progress.finish("failed")).toEqual([
    { stage: "context", durationMs: 10, outcome: "failed" },
  ]);
});
