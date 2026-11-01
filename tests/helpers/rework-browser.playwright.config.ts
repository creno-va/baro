import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../browser",
  testMatch: "rework-conversation.e2e.ts",
  workers: 1,
  timeout: 120000,
  use: { baseURL: "http://127.0.0.1:4396", trace: "off" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    env: { PUBLIC_API_MODE: "real", BARO_UI_TEST_FIXTURE: "true" },
    command:
      "bun run dev -- --ignore-lock --config tests/helpers/rework-browser.astro.config.ts --host 127.0.0.1 --port 4396",
    url: "http://127.0.0.1:4396/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
