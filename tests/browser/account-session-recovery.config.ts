import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "account-session-recovery.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4408", browserName: "chromium", trace: "off" },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true", PUBLIC_API_MODE: "real" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4408",
    url: "http://127.0.0.1:4408/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
