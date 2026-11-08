import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "auth.e2e.ts",
    "settings.e2e.ts",
    "policy-content.e2e.ts",
    "landing.e2e.ts",
    "public-account-redesign.e2e.ts",
    "legacy-profile-assets.e2e.ts",
  ],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4474", browserName: "chromium", trace: "off" },
  webServer: {
    env: {
      BARO_UI_TEST_FIXTURE: "true",
      PUBLIC_API_MODE: "real",
      WRANGLER_LOG_PATH: "/private/tmp/baro-redesign-04-wrangler.log",
    },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4474",
    url: "http://127.0.0.1:4474/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
