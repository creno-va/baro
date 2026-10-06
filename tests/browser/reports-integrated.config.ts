import { defineConfig } from "@playwright/test";
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
