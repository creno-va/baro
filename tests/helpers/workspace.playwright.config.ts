import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../browser",
  testMatch: "workspace.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4342", browserName: "chromium", trace: "off" },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true", BARO_C_TEST_API: "true" },
    command:
      "bun run dev -- --config tests/helpers/workspace.astro.config.ts --host 127.0.0.1 --port 4342",
    url: "http://127.0.0.1:4342/cases/synthetic-case",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
