import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "customer-completion.e2e.ts",
  workers: 1,
  outputDir: "../../.wrangler/ui624-customer-completion",
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:4531", browserName: "chromium", trace: "off" },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true", ASTRO_TELEMETRY_DISABLED: "1" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4531",
    url: "http://127.0.0.1:4531/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
