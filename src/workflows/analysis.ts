import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createLegacyAnalysisRuntime, LEGACY_ANALYSIS_PHASES } from "../server/runtime/analysis";
export interface AnalysisWorkflowParams {
  analysisId: string;
  inputRevision: number;
}
export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisWorkflowParams> {
  override async run(event: WorkflowEvent<AnalysisWorkflowParams>, step: WorkflowStep) {
    const execution = await createLegacyAnalysisRuntime(this.env, event.payload, event.instanceId, {
      waitUntil: (work) => this.ctx.waitUntil(work),
    });
    for (const phase of LEGACY_ANALYSIS_PHASES) {
      // Sensitive outputs live only in encrypted D1, never Workflow step state.
      const result = await step.do(
        phase,
        { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
        () => execution.phase(phase),
      );
      if (result.status === "waiting_for_answers") {
        await step
          .waitForEvent("answers reference", { type: "answers", timeout: "24 hours" })
          .catch(() => undefined);
        return step.do("expire or superseded", () => execution.expire());
      }
      if (
        result.status === "stopped" ||
        result.status === "failed" ||
        result.status === "completed"
      )
        return result;
    }
    return {
      analysisId: event.payload.analysisId,
      inputRevision: event.payload.inputRevision,
      status: "stopped",
    };
  }
}
