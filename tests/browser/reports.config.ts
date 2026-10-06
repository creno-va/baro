import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "reports.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4343", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    url: "http://127.0.0.1:4343/settings",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
