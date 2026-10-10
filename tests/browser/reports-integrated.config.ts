import { defineConfig } from "@playwright/test";

// Selecting this configuration opts into the actual shared-product mock flow.
process.env.BARO_D_SHARED_API = "true";
const port = process.env.BARO_REPORT_PORT ?? "4343";
export default defineConfig({
  testDir: ".",
  testMatch: "reports-integrated.e2e.ts",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "off" },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true", PUBLIC_API_MODE: "mock" },
    command: `bun run dev -- --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
