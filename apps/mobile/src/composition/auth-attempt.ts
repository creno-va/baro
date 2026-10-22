import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  getRandomBytesAsync,
} from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createPendingAuthStore } from "../platform/auth/attempt";
import { createNativeProof } from "../platform/auth/proof";
import { readMobileConfig } from "./config";

let store: ReturnType<typeof createPendingAuthStore> | undefined;
export function getPendingAuthStore() {
  if (!store) {
    const config = readMobileConfig();
    const options: SecureStore.SecureStoreOptions = {
      keychainService: `${config.applicationId}.auth`,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
    store = createPendingAuthStore({
      key: `baro_${config.environment}_auth_attempt`,
      now: Date.now,
      storage: {
        getItemAsync: (key) => SecureStore.getItemAsync(key, options),
        setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
        deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
      },
    });
  }
  return store;
}
export const newNativeProof = () =>
  createNativeProof({
    // Async native entropy has no development Math.random fallback.
    randomBytes: () => getRandomBytesAsync(32),
    sha256: async (verifier) => {
      const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, verifier, {
        encoding: CryptoEncoding.HEX,
      });
      if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("MOBILE_AUTH_DIGEST_INVALID");
      return Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
      );
    },
  });
