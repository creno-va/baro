import { createCaseDataCipher } from "../crypto";
import { createV2Core } from "../db/v2-core";
import type { PublicationDependencies } from "../modules/lawyers/publication";
import {
  createProfilePublicationExecution,
  type ProfilePublicationParams,
} from "../modules/lawyers/publication-execution";

/** Only the deployment composition may supply a verified storage admission or
 * sanitized decoder. Missing capabilities leave the approval pending. */
export async function createProfilePublicationRuntime(
  env: Env,
  params: ProfilePublicationParams,
  instanceId: string,
  _waitUntil: (task: Promise<void>) => void,
  capabilities: Omit<PublicationDependencies, "publicBucket" | "fixedLengthStream"> = {},
) {
  const core = createV2Core(env.DB, await createCaseDataCipher(env));
  return createProfilePublicationExecution(
    core,
    { ...capabilities, publicBucket: env.PROFILE_PUBLIC_R2 },
    params,
    instanceId,
  );
}
