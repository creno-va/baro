import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = "4361";
export default defineConfig({
  testDir: ".",
  testMatch: "file-review-loading.e2e.ts",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: { BARO_FILE_REVIEW_HTTP_FIXTURE: "true", BARO_REPORT_TEST_PORT: port },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
