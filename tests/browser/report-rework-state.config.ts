import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = process.env.BARO_REPORT_TEST_PORT ?? "4378";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "report-rework-state.e2e.ts",
  workers: 1,
  use: { baseURL, browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: { BARO_REPORT_HTTP_FIXTURE: "true", BARO_REPORT_TEST_PORT: port },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
