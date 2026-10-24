import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "app-experience.e2e.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4341",
    browserName: "chromium",
    trace: "off",
    launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  },
  webServer: {
    env: { BARO_UI_TEST_FIXTURE: "true", PUBLIC_API_MODE: "real", ASTRO_TELEMETRY_DISABLED: "1" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4341",
    url: "http://127.0.0.1:4341/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
