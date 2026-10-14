import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "intake-saved-review.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4637", browserName: "chromium", trace: "off" },
  webServer: {
    env: {
      PUBLIC_API_MODE: "mock",
      BARO_UI_TEST_FIXTURE: "true",
      ASTRO_TELEMETRY_DISABLED: "1",
      WRANGLER_LOG_PATH: "/tmp/baro-intake-review-wrangler.log",
    },
    command: "bun run dev -- --host 127.0.0.1 --port 4637 --ignore-lock",
    url: "http://127.0.0.1:4637/cases",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
