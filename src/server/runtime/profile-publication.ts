import { createCaseDataCipher } from "../crypto";
import { createV2Core } from "../db/v2-core";
import {
  createLawyerPublicationService,
  type PublicationDependencies,
} from "../modules/lawyers/publication";
import {
  createProfilePublicationExecution,
  type ProfilePublicationParams,
} from "../modules/lawyers/publication-execution";
import {
  createLawyerStorageBudget,
  lawyerStorageRequestCore,
} from "../modules/lawyers/storage-runtime";
import { createSanitizedReaders } from "./sanitized-reader";

/** Only the deployment composition may supply a verified storage admission or
 * sanitized decoder. Missing capabilities leave the approval pending. */
export async function createProfilePublicationRuntime(
  env: Env,
  params: ProfilePublicationParams,
  instanceId: string,
  _waitUntil: (task: Promise<void>) => void,
  capabilities: Omit<PublicationDependencies, "publicBucket" | "fixedLengthStream"> = {},
) {
  const core = createV2Core(env.DB, await createCaseDataCipher(env), {
    applicationCostLimitsEnabled: env.APPLICATION_COST_LIMITS_ENABLED !== "false",
    monthlyBudgetCapEnabled: env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
  });
  const environment = env.APP_ENV === "production" ? "production" : "preview";
  const dependencies = (requestCore: typeof core): PublicationDependencies => ({
    environment,
    paidStorage: (ownerId) => createLawyerStorageBudget(requestCore, environment, ownerId),
    ...(env.CASE_PRIVATE_R2
      ? {
          openSanitized: createSanitizedReaders(requestCore, {
            environment,
            bucket: env.CASE_PRIVATE_R2,
          }).publication,
        }
      : {}),
    ...capabilities,
    publicBucket: env.PROFILE_PUBLIC_R2,
  });
  return createProfilePublicationExecution(core, dependencies(core), params, instanceId, () => {
    const requestCore =
      environment === "preview" && capabilities.testOnlyUnmeteredStorage === true
        ? core
        : lawyerStorageRequestCore(core);
    return createLawyerPublicationService(requestCore, dependencies(requestCore));
  });
}
