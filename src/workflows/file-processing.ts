import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createFileProcessingRuntime } from "../server/modules/budget/processing-runtime";
import {
  type FileProcessingParams,
  fileProcessingParamsSchema,
} from "../server/modules/file-processing/execution";
import { runFileProcessing } from "../server/modules/file-processing/runner";

export class FileProcessingWorkflow extends WorkflowEntrypoint<Env, FileProcessingParams> {
  override async run(event: WorkflowEvent<FileProcessingParams>, step: WorkflowStep) {
    const params = fileProcessingParamsSchema.parse(event.payload);
    const execution = await createFileProcessingRuntime(
      this.env,
      params,
      event.instanceId,
      (task) => this.ctx.waitUntil(task),
    );
    return runFileProcessing(execution, step);
  }
}
