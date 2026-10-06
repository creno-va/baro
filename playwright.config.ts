import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4337", browserName: "chromium", trace: "off" },
  webServer: {
    env: { PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", BARO_UI_TEST_FIXTURE: "true" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4337",
    url: "http://127.0.0.1:4337/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
