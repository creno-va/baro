import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "conversation-home.e2e.ts",
    "intake103.e2e.ts",
    "shell-integration.e2e.ts",
    "workspace-shared.e2e.ts",
  ],
  workers: 1,
  use: {
    baseURL: process.env.BARO_DESIGN_URL ?? "http://127.0.0.1:4350",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  ...(process.env.BARO_DESIGN_URL
    ? {}
    : {
        webServer: {
          env: {
            PUBLIC_API_MODE: "mock",
            BARO_UI_TEST_FIXTURE: "true",
            ASTRO_TELEMETRY_DISABLED: "1",
          },
          command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4350",
          url: "http://127.0.0.1:4350/login",
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
