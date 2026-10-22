import { getRandomBytesAsync, randomUUID } from "expo-crypto";
import { ChallengeHost } from "../features/challenge/ui/ChallengeHost";
import { encodeProofBytes } from "../platform/auth/proof";
import { createChallengeModel } from "../platform/challenge/model";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

let model: ReturnType<typeof createChallengeModel> | undefined;
export function getMobileChallenge() {
  model ??= createChallengeModel({
    config: readMobileConfig(),
    scope: getMobileCredentials().scope,
    newId: randomUUID,
    newSecret: async () => encodeProofBytes(await getRandomBytesAsync(32)),
  });
  return model;
}
export const mobileSecurityToken = (signal?: AbortSignal) => getMobileChallenge().request(signal);
export function MobileChallengePortal() {
  try {
    return <ChallengeHost model={getMobileChallenge()} />;
  } catch {
    return null;
  }
}
