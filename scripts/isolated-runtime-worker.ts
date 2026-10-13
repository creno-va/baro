import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  handleRuntimeDrill,
  type RuntimeDrillEnv,
  type RuntimeDrillParams,
} from "./isolated-runtime-control";

export class IsolatedRecoveryWorkflow extends WorkflowEntrypoint<
  RuntimeDrillEnv,
  RuntimeDrillParams
> {
  override async run(event: WorkflowEvent<RuntimeDrillParams>, step: WorkflowStep) {
    if (event.payload.mode === "wait") await step.sleep("synthetic-wait", "10 minutes");
    return { synthetic: true };
  }
}

export default { fetch: handleRuntimeDrill };
