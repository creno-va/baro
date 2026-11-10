import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "report-rework-state.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4378", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: { BARO_REPORT_HTTP_FIXTURE: "true", BARO_REPORT_TEST_PORT: "4378" },
    url: "http://127.0.0.1:4378",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
