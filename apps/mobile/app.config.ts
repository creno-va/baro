import type { ExpoConfig } from "expo/config";
import { nativeAssets } from "./config/assets.ts";
import { resolveMobileConfig } from "./config/environment.ts";

const target = resolveMobileConfig({
  environment: process.env.EXPO_PUBLIC_APP_ENV,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL,
});

const config: ExpoConfig = {
  name: target.name,
  slug: "baro-mobile",
  icon: nativeAssets.icon,
  version: "0.1.0",
  scheme: target.scheme,
  platforms: ["ios", "android"],
  userInterfaceStyle: "light",
  ios: { bundleIdentifier: target.applicationId, supportsTablet: true },
  android: { package: target.applicationId },
  plugins: [
    "expo-router",
    "expo-dev-client",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-font",
      {
        android: {
          fonts: [
            {
              fontFamily: nativeAssets.family,
              path: nativeAssets.font,
              fontDefinitions: nativeAssets.weights.map((weight) => ({ weight, style: "normal" })),
            },
          ],
        },
        ios: { fonts: [nativeAssets.font] },
      },
    ],
  ],
  experiments: { typedRoutes: true },
  updates: { enabled: false },
};

export default config;
