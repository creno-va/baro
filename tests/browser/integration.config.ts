import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["shell-integration.e2e.ts", "lawyer-api-mock.e2e.ts"],
  workers: 1,
  use: {
    baseURL: process.env.BARO_INTEGRATION_URL ?? "http://127.0.0.1:4340",
    browserName: "chromium",
    trace: "off",
  },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true", ASTRO_TELEMETRY_DISABLED: "1" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4340",
    url: "http://127.0.0.1:4340/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
