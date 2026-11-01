import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "intake-reconfirmation.e2e.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4639",
    browserName: "chromium",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    env: {
      PUBLIC_API_MODE: "mock",
      BARO_UI_TEST_FIXTURE: "true",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
    command:
      "bun run dev -- --host 127.0.0.1 --port 4639 --ignore-lock --config tests/helpers/intake-reconfirmation.astro.config.ts",
    url: "http://127.0.0.1:4639/cases",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
