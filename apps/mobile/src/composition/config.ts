import { resolveMobileConfig } from "../../config/environment";

/** Expo replaces these literal public environment reads during bundling. No Node runtime. */
export function readMobileConfig() {
  return resolveMobileConfig({
    environment: process.env.EXPO_PUBLIC_APP_ENV,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL,
  });
}
