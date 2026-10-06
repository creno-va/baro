import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "customer-real.e2e.ts",
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4355", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    env: {
      PUBLIC_API_MODE: "real",
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      BARO_UI_TEST_FIXTURE: "true",
      ASTRO_TELEMETRY_DISABLED: "1",
      WRANGLER_LOG_PATH: "/tmp/baro-customer-browser.log",
    },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4355",
    url: "http://127.0.0.1:4355/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
