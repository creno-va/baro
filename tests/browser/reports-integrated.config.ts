import { defineConfig } from "@playwright/test";

// Selecting this configuration opts into the actual shared-product mock flow.
process.env.BARO_D_SHARED_API = "true";
export default defineConfig({
  testDir: ".",
  testMatch: "reports-integrated.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4343", browserName: "chromium", trace: "off" },
  webServer: {
    command:
      "BARO_UI_TEST_FIXTURE=true PUBLIC_API_MODE=mock bun run dev -- --host 127.0.0.1 --port 4343 --ignore-lock",
    url: "http://127.0.0.1:4343/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
