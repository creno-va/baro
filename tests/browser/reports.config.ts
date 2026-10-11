import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "reports.e2e.ts",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${process.env.BARO_REPORT_TEST_PORT ?? "4343"}`,
    browserName: "chromium",
    trace: "off",
  },
});
