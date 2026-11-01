import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../browser",
  testMatch: "conversation-agent.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4394", browserName: "chromium", trace: "off" },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true" },
    command:
      "bun run dev -- --ignore-lock --config tests/helpers/conversation-agent.astro.config.ts --host 127.0.0.1 --port 4394",
    url: "http://127.0.0.1:4394/__conversation-agent",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
