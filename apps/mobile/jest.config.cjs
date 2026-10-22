const expoPreset = require("jest-expo/jest-preset");
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/tests/**/*.ui.tsx"],
  clearMocks: true,
  transform: { ...expoPreset.transform, "\\.mjs$": expoPreset.transform["\\.[jt]sx?$"] },
  // Bun's isolated linker adds a .bun store before the real package node_modules.
  transformIgnorePatterns: [
    "node_modules/(?!\\.bun/|(?:jest-)?react-native/|@react-native/|@react-native-community/|expo/|expo-[^/]+/|@expo/|@noble/|@react-navigation/|react-native-[^/]+/|test-renderer/|@better-auth/|better-auth/|@better-fetch/|nanostores/|@nanostores/)",
  ],
};
