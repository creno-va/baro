import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "report-rework-layout.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4377", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/report-rework-layout-server.ts",
    url: "http://127.0.0.1:4377",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
