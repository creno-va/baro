import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createCaseDataCipher } from "../server/crypto";
import { createV2Core } from "../server/db/v2-core";
import {
  createDirectoryMaintenance,
  type DirectoryMaintenanceParams,
  directoryMaintenanceSchema,
} from "../server/modules/lawyers/directory-maintenance";
import {
  type ProfilePublicationParams,
  runProfilePublicationSteps,
} from "../server/modules/lawyers/publication-execution";
import { createProfilePublicationRuntime } from "../server/runtime/profile-publication";

export class ProfilePublicationWorkflow extends WorkflowEntrypoint<
  Env,
  ProfilePublicationParams | DirectoryMaintenanceParams
> {
  override async run(
    event: WorkflowEvent<ProfilePublicationParams | DirectoryMaintenanceParams>,
    step: WorkflowStep,
  ) {
    if ("maintenance" in event.payload) {
      const params = directoryMaintenanceSchema.parse(event.payload);
      if (params.expectedReleaseSha !== this.env.RELEASE_SHA)
        throw new Error("DIRECTORY_RELEASE_MISMATCH");
      const maintenance = createDirectoryMaintenance(
        createV2Core(this.env.DB, await createCaseDataCipher(this.env)),
      );
      let after = params.after ?? "",
        processed = 0,
        indexed = 0,
        next: string | null = after;
      while (processed < params.maximumProfiles) {
        const result = await step.do(`directory-${processed}`, () =>
          maintenance.batch(after, Math.min(20, params.maximumProfiles - processed)),
        );
        processed += result.processed;
        indexed += result.indexed;
        next = result.next;
        if (!result.next) break;
        after = result.next;
      }
      return { processed, indexed, next, releaseSha: params.expectedReleaseSha };
    }
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
