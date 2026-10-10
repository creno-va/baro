import { defineConfig } from "@playwright/test";

const port = process.env.BARO_ACCOUNT_TEST_PORT ?? "4343";
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "settings.e2e.ts",
  workers: 1,
  use: { baseURL: origin, browserName: "chromium", trace: "off" },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true", PUBLIC_API_MODE: "real" },
    command: `bun run dev -- --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: `${origin}/settings`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
