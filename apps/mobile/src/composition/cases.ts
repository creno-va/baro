import { ApiError, createCasesClient } from "@baro/api-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createCaseOperationStorage } from "../platform/storage/case-operations";
import { getMobileApi } from "./api";
import { mobileSecurityToken } from "./challenge";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

let storage: ReturnType<typeof createCaseOperationStorage> | undefined;
export function getCaseOperationStorage() {
  if (!storage) {
    const config = readMobileConfig();
    const options: SecureStore.SecureStoreOptions = {
      keychainService: `${config.applicationId}.case-operations`,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
    storage = createCaseOperationStorage({
      namespace: `baro_${config.environment}_case_operations`,
      fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
      storage: {
        get: (key) => SecureStore.getItemAsync(key, options),
        set: (key, value) => SecureStore.setItemAsync(key, value, options),
        remove: (key) => SecureStore.deleteItemAsync(key, options),
      },
    });
  }
  return storage;
}
export function createNativeCases(signal: AbortSignal) {
  return createCasesClient({
    mode: "real",
    scope: getMobileCredentials().scope,
    signal,
    request: (_operation, _input, options = {}) => {
      if (!options.path) throw new ApiError("VALIDATION_ERROR", "요청 경로를 확인해 주세요.");
      return getMobileApi().request({ ...options, path: options.path });
    },
    persistence: "required",
    storage: getCaseOperationStorage(),
    fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    newKey: randomUUID,
    challenge: mobileSecurityToken,
  });
}
