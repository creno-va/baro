import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createAssetProcessingRuntime } from "../server/modules/budget/asset-runtime";
import { runAssetProcessing } from "../server/modules/file-processing/asset-runner";
import {
  type AssetProcessingParams,
  assetProcessingParamsSchema,
} from "../server/modules/file-processing/assets";

export class AssetProcessingWorkflow extends WorkflowEntrypoint<Env, AssetProcessingParams> {
  override async run(event: WorkflowEvent<AssetProcessingParams>, step: WorkflowStep) {
    const params = assetProcessingParamsSchema.parse(event.payload);
    const execution = await createAssetProcessingRuntime(this.env, params, event.instanceId);
    return runAssetProcessing(execution, step);
  }
}
