import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "reports.e2e.ts",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${process.env.BARO_REPORT_TEST_PORT ?? "4343"}`,
    browserName: "chromium",
    colorScheme: "dark",
    trace: "off",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/reports-ui-server.ts",
    env: { BARO_REPORT_TEST_PORT: process.env.BARO_REPORT_TEST_PORT ?? "4343" },
    url: `http://127.0.0.1:${process.env.BARO_REPORT_TEST_PORT ?? "4343"}`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
