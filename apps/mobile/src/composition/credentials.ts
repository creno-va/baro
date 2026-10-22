import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { createNativeCredentials } from "../platform/auth/credentials";
import { readMobileConfig } from "./config";

let credentials: ReturnType<typeof createNativeCredentials> | undefined;
const scope = createSessionScope();
export function getMobileCredentials() {
  if (!credentials) {
    const config = readMobileConfig();
    const options: SecureStore.SecureStoreOptions = {
      keychainService: `${config.applicationId}.auth`,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
    credentials = createNativeCredentials({
      scope,
      namespace: `baro_${config.environment}_auth`,
      storage: {
        getItemAsync: (key) => SecureStore.getItemAsync(key, options),
        setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
      },
      manageStorage: storageAdapter,
      codec: { header: getCookie, merge: getSetCookie },
    });
  }
  return { scope, credentials };
}
