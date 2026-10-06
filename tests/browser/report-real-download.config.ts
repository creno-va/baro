import { defineConfig } from "@playwright/test";

// The test starts its own signed SQL server on an ephemeral port.
export default defineConfig({
  testDir: ".",
  testMatch: "report-real-download.e2e.ts",
  workers: 1,
  timeout: 60000,
  use: { browserName: "chromium", trace: "off" },
});
