import { ApiError } from "@baro/api-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { Linking } from "react-native";
import { createAccountCleanup } from "../platform/account/cleanup";
import { createNativeAccountClient } from "../platform/account/client";
import { getMobileApi } from "./api";
import { getReauthenticationStore } from "./auth-attempt";
import { getCaseOperationStorage } from "./cases";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { resetPrivateFiles } from "./files";
import { getNativeLogin } from "./login";
import { getSessionModel } from "./session";

export function openNativePolicy(policy: "terms" | "privacy" | "ai") {
  return Linking.openURL(`${readMobileConfig().apiBaseUrl}/policies/${policy}`);
}

export function createNativeAccount(
  signal: AbortSignal,
  ownerId: string,
  onAccepted: (receipt: { ownerId: string }) => void,
) {
  const { scope } = getMobileCredentials(),
    generation = scope.snapshot();
  return createNativeAccountClient({
    scope,
    signal,
    ownerId,
    request: getMobileApi().request,
    storage: getCaseOperationStorage(),
    fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    newKey: randomUUID,
    readReauthentication: () => getReauthenticationStore().load(),
    reauthenticate: async (provider) => {
      const session = getSessionModel();
      await session.loadReauthentication();
      signal.throwIfAborted();
      if (!scope.isCurrent(generation) || session.getSnapshot().session?.user?.id !== ownerId)
        throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
      await session.reauthenticate(provider);
    },
    onAccepted,
    cleanup: createAccountCleanup({
      resetPrivateFiles,
      cancelLogin: (options) => getNativeLogin().cancel(options),
    }),
  });
}
