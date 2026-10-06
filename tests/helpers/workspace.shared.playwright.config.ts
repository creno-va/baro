import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../browser",
  testMatch: "workspace-shared.e2e.ts",
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4342", browserName: "chromium", trace: "off" },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true" },
    command: "bun run dev -- --host 127.0.0.1 --port 4342",
    url: "http://127.0.0.1:4342/login",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
