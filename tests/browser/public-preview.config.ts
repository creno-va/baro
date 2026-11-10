import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "public-preview.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4362", browserName: "chromium", trace: "off" },
  webServer: {
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4362",
    env: {
      CLOUDFLARE_ENV: "",
      BARO_UI_TEST_FIXTURE: "true",
      PUBLIC_API_MODE: "mock",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
    url: "http://127.0.0.1:4362/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
