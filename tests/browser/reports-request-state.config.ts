import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = process.env.BARO_REPORT_TEST_PORT ?? "4359";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "report-draft-revision.e2e.ts",
  workers: 1,
  use: { baseURL: origin, browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: { BARO_REPORT_HTTP_FIXTURE: "true", BARO_REPORT_TEST_PORT: port },
    url: origin,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
