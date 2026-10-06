import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { WorkspaceParams } from "../server/modules/workspace/execution";
import { runWorkspaceRuntime } from "../server/runtime/workspace";

export class WorkspaceWorkflow extends WorkflowEntrypoint<Env, WorkspaceParams> {
  override async run(event: WorkflowEvent<WorkspaceParams>, step: WorkflowStep) {
    // Step state contains opaque references and status only, never case content or model output.
    return step.do(
      "prepare workspace response",
      { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
      () =>
        runWorkspaceRuntime(this.env, event.payload, event.instanceId, (promise) =>
          this.ctx.waitUntil(promise),
        ),
    );
  }
}
