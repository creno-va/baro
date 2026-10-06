import { defineConfig } from "@playwright/test";

const port = process.env.BARO_WORKSPACE_UI_PORT ?? "4342";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("INVALID_BROWSER_TEST_PORT");
export default defineConfig({
  testDir: "../browser",
  testMatch: "workspace-shared.e2e.ts",
  workers: 1,
  timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "off" },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true" },
    command: `bun run dev -- --ignore-lock --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
