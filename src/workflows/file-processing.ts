import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createFileProcessingRuntime } from "../server/modules/budget/processing-runtime";
import {
  type FileProcessingParams,
  fileProcessingParamsSchema,
} from "../server/modules/file-processing/execution";
import { runFileProcessing } from "../server/modules/file-processing/runner";
import { resumeReworkCase } from "../server/runtime/rework-recovery";

export class FileProcessingWorkflow extends WorkflowEntrypoint<Env, FileProcessingParams> {
  override async run(event: WorkflowEvent<FileProcessingParams>, step: WorkflowStep) {
    const params = fileProcessingParamsSchema.parse(event.payload);
    const execution = await createFileProcessingRuntime(
      this.env,
      params,
      event.instanceId,
      (task) => this.ctx.waitUntil(task),
    );
    const result = await runFileProcessing(execution, step);
    await step.do(
      "resume confirmed case preparation",
      { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
      async () => {
        const resumed = await resumeReworkCase(this.env, params.ownerId, params.workspaceId);
        return { status: resumed.status };
      },
    );
    return result;
  }
}
