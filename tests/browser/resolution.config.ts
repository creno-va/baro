import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "resolution.e2e.ts",
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${process.env.BARO_RESOLUTION_TEST_PORT ?? "4376"}`,
    browserName: "chromium",
    trace: "off",
  },
});
