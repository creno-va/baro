import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = "4364";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "report-mock-photos.e2e.ts",
  workers: 1,
  use: { baseURL: origin, browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: {
      BARO_REPORT_HTTP_FIXTURE: "true",
      BARO_REPORT_TEST_PORT: port,
      BARO_REPORT_MOCK_PHOTOS: "true",
    },
    url: origin,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
