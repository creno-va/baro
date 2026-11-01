import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../browser",
  testMatch: "rework-shared-mock.e2e.ts",
  workers: 1,
  timeout: 90000,
  use: { baseURL: "http://127.0.0.1:4397", trace: "off" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4397",
    url: "http://127.0.0.1:4397/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
