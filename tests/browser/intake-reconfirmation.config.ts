import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "intake-reconfirmation.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4638", browserName: "chromium", trace: "off" },
  webServer: {
    env: {
      PUBLIC_API_MODE: "mock",
      BARO_UI_TEST_FIXTURE: "true",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
    command: "bun run dev -- --host 127.0.0.1 --port 4638 --ignore-lock",
    url: "http://127.0.0.1:4638/cases",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
