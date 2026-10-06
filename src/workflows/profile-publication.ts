import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  type ProfilePublicationParams,
  runProfilePublicationSteps,
} from "../server/modules/lawyers/publication-execution";
import { createProfilePublicationRuntime } from "../server/runtime/profile-publication";

export class ProfilePublicationWorkflow extends WorkflowEntrypoint<Env, ProfilePublicationParams> {
  override async run(event: WorkflowEvent<ProfilePublicationParams>, step: WorkflowStep) {
    const execution = await createProfilePublicationRuntime(
      this.env,
      event.payload,
      event.instanceId,
      (promise: Promise<void>) => this.ctx.waitUntil(promise),
    );
    return runProfilePublicationSteps(execution, step);
  }
}
export type { ProfilePublicationParams } from "../server/modules/lawyers/publication-execution";
