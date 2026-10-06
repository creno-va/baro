import type { WorkflowStep } from "cloudflare:workers";
import type { AssetProcessingExecution } from "./asset-execution";

export function runAssetProcessing(execution: AssetProcessingExecution, step: WorkflowStep) {
  return step.do(
    "sanitize private profile asset",
    { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240000);
      try {
        return await execution.run(controller.signal);
      } catch (error) {
        return execution.fail(error);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  );
}
