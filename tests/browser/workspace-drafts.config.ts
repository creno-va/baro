import { defineConfig } from "@playwright/test";

const port = process.env.BARO_WORKSPACE_DRAFT_UI_PORT ?? "4511";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("INVALID_BROWSER_TEST_PORT");
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-drafts.e2e.ts",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "off" },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true" },
    command: `bun run dev -- --ignore-lock --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/cases/synthetic-draft-case`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
