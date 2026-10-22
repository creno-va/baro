import type { ExpoConfig } from "expo/config";
import { resolveMobileConfig } from "./config/environment.ts";

const target = resolveMobileConfig({
  environment: process.env.EXPO_PUBLIC_APP_ENV,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL,
});

const config: ExpoConfig = {
  name: target.name,
  slug: "baro-mobile",
  version: "0.1.0",
  scheme: target.scheme,
  platforms: ["ios", "android"],
  userInterfaceStyle: "light",
  ios: { bundleIdentifier: target.applicationId, supportsTablet: true },
  android: { package: target.applicationId },
  plugins: ["expo-router", "expo-dev-client"],
  experiments: { typedRoutes: true },
  updates: { enabled: false },
};

export default config;
