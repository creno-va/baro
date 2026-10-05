import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/security-browser",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4338", browserName: "chromium", trace: "off" },
  webServer: {
    command:
      "bunx wrangler dev --config dist/server/wrangler.json --ip 127.0.0.1 --port 4338 --local --var APP_ENV:production --var PUBLIC_BETA_ENABLED:false",
    url: "http://127.0.0.1:4338/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
