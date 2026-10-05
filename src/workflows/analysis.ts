import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  createAnalysisExecution,
  type ExecutionPhase,
} from "../server/modules/case-structure/execution";
import { domainRepository } from "../server/modules/intake/service";
import { createLegalRetrieval } from "../server/modules/legal-retrieval/service";
import { createLlmGateway } from "../server/modules/llm-gateway/service";
export interface AnalysisWorkflowParams {
  analysisId: string;
  inputRevision: number;
}
export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisWorkflowParams> {
  override async run(event: WorkflowEvent<AnalysisWorkflowParams>, step: WorkflowStep) {
    const repo = await domainRepository(this.env);
    const execution = createAnalysisExecution(
      this.env,
      event.payload,
      event.instanceId,
      createLlmGateway(this.env),
      createLegalRetrieval(this.env, repo),
    );
    const phases: ExecutionPhase[] = [
      "initialize",
      "minimize",
      "screening",
      "structure",
      "questions",
      "retrieval",
      "generation",
      "validation",
      "finish",
    ];
    for (const phase of phases) {
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
      if (result.status === "stopped" || result.status === "failed") return result;
    }
    return {
      analysisId: event.payload.analysisId,
      inputRevision: event.payload.inputRevision,
      status: "stopped",
    };
  }
}
