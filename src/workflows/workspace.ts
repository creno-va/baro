import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { WorkspaceParams } from "../server/modules/workspace/execution";
import { runWorkspaceRuntime } from "../server/runtime/workspace";

export class WorkspaceWorkflow extends WorkflowEntrypoint<Env, WorkspaceParams> {
  override async run(event: WorkflowEvent<WorkspaceParams>, step: WorkflowStep) {
    // Step state contains opaque references and status only, never case content or model output.
    return step.do(
      "prepare workspace response",
      // Intake recovery can execute generation + audit twice. Each gateway phase
      // retains its own bounded attempts and renews the five-minute fenced lease.
      // The outer timeout must leave room for all four phases to settle and publish.
      { retries: { limit: 0, delay: "1 second" }, timeout: "20 minutes" },
      () =>
        runWorkspaceRuntime(this.env, event.payload, event.instanceId, (promise) =>
          this.ctx.waitUntil(promise),
        ),
    );
  }
}
