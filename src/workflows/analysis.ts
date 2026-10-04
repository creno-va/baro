import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface AnalysisWorkflowParams {
  analysisId: string;
  inputRevision: number;
}

export interface AnalysisWorkflowResult {
  analysisId: string;
  inputRevision: number;
  status: "scaffolded";
}

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisWorkflowParams> {
  override async run(
    event: WorkflowEvent<AnalysisWorkflowParams>,
    step: WorkflowStep,
  ): Promise<AnalysisWorkflowResult> {
    return step.do("acknowledge analysis", async () => ({
      analysisId: event.payload.analysisId,
      inputRevision: event.payload.inputRevision,
      status: "scaffolded" as const,
    }));
  }
}
