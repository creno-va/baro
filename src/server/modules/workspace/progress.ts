import type { V2Job } from "../../../contracts/v2";

const phases = {
  context: "admission",
  generation: "generating",
  retrieval: "retrieving",
  audit: "validating",
  publication: "assembling",
} as const satisfies Record<string, V2Job["phase"]>;
type Stage = keyof typeof phases;
type Timing = { stage: Stage; durationMs: number; outcome: "completed" | "failed" };

/** Only fixed stages and monotonic durations enter the private Workflow receipt. */
export function createWorkspaceProgress(
  checkpoint: (phase: (typeof phases)[Stage]) => Promise<void>,
  clock = () => performance.now(),
) {
  const timings: Timing[] = [];
  let current: { stage: Stage; started: number } | undefined;
  const finish = (outcome: Timing["outcome"]) => {
    if (current) {
      timings.push({
        stage: current.stage,
        durationMs: Math.max(0, Math.round(clock() - current.started)),
        outcome,
      });
      current = undefined;
    }
    return timings;
  };
  return {
    async enter(stage: Stage) {
      await checkpoint(phases[stage]);
      finish("completed");
      current = { stage, started: clock() };
    },
    finish,
  };
}
export type WorkspaceProgress = ReturnType<typeof createWorkspaceProgress>;
