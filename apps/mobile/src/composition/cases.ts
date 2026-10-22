import {
  ApiError,
  createCaseDeletionClient,
  createCasesClient,
  type DomainRequest,
} from "@baro/api-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createCaseOperationStorage } from "../platform/storage/case-operations";
import { getMobileApi } from "./api";
import { mobileSecurityToken } from "./challenge";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { getSessionModel } from "./session";

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
export function createNativeCases(
  signal: AbortSignal,
  ownerId: string,
  onDeleted: (id: string) => void,
) {
  const scope = getMobileCredentials().scope;
  const request: DomainRequest = (path, options = {}) =>
    getMobileApi().request({
      ...options,
      path,
      expectedOwner: ownerId,
      signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
      ...(options.headers?.["idempotency-key"] ? { key: options.headers["idempotency-key"] } : {}),
    });
  const cases = createCasesClient({
    mode: "real",
    scope,
    signal,
    includeLegacyDetails: true,
    request: (_operation, _input, options = {}) => {
      if (!options.path) throw new ApiError("VALIDATION_ERROR", "요청 경로를 확인해 주세요.");
      return getMobileApi().request({ ...options, path: options.path, expectedOwner: ownerId });
    },
    persistence: "required",
    storage: getCaseOperationStorage(),
    fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    newKey: randomUUID,
    challenge: mobileSecurityToken,
  });
  const deletion = createCaseDeletionClient({
    request,
    scope,
    signal,
    newKey: randomUUID,
    coalesceWrites: "credential-scope",
    recovery: {
      ownerId,
      storage: getCaseOperationStorage(),
      fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    },
    onDeleted: async (id) => {
      try {
        onDeleted(id);
      } finally {
        scope.invalidate();
        await getSessionModel().refresh();
      }
    },
  });
  return { ...cases, deleteCase: deletion.deleteCase };
}
