import type { WorkflowStep } from "cloudflare:workers";
import type { AssetProcessingExecution } from "./asset-execution";

export function runAssetProcessing(
  execution: Pick<AssetProcessingExecution, "run" | "fail"> &
    Partial<Pick<AssetProcessingExecution, "timings">>,
  step: WorkflowStep,
) {
  return step.do(
    "sanitize private profile asset",
    { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240000);
      try {
        let result: Awaited<
          ReturnType<AssetProcessingExecution["run"] | AssetProcessingExecution["fail"]>
        >;
        try {
          result = await execution.run(controller.signal);
        } catch (error) {
          const failed = execution.fail(error);
          // Preserve the prior cancellation point while awaiting only the
          // failure-record duration: no pending transport waits on that write.
          clearTimeout(timer);
          controller.abort();
          result = await failed;
        }
        try {
          const stageTimings = execution.timings?.();
          return stageTimings?.length ? { ...result, stageTimings } : result;
        } catch {
          // Optional diagnostics cannot replace a completed product result.
          return result;
        }
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  );
}
