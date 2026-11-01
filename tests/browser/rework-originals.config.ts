import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "rework-originals.e2e.ts",
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { baseURL: "http://127.0.0.1:4389", trace: "off" },
  webServer: {
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4389",
    url: "http://127.0.0.1:4389/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true" },
  },
});
