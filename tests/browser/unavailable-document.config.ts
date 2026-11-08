import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "unavailable-document.e2e.ts",
  workers: 1,
  use: { browserName: "chromium", javaScriptEnabled: false, trace: "retain-on-failure" },
});
