import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "intake103.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4341", browserName: "chromium", trace: "off" },
  webServer: {
    env: {
      PUBLIC_API_MODE: "mock",
      BARO_UI_TEST_FIXTURE: "true",
      ASTRO_TELEMETRY_DISABLED: "1",
      WRANGLER_LOG_PATH: "/tmp/baro-b-wrangler.log",
    },
    command: "bun run dev -- --host 127.0.0.1 --port 4341 --ignore-lock",
    url: "http://127.0.0.1:4341/cases",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
