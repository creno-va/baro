module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/tests/**/*.ui.tsx"],
  clearMocks: true,
  // Bun's isolated linker adds a .bun store before the real package node_modules.
  transformIgnorePatterns: [
    "node_modules/(?!\\.bun/|(?:jest-)?react-native/|@react-native/|@react-native-community/|expo/|expo-[^/]+/|@expo/|@react-navigation/|react-native-[^/]+/|test-renderer/)",
  ],
};
