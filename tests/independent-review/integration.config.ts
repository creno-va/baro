import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "integration.e2e.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 6000 },
  outputDir: resolve("test-results/independent-review"),
  reporter: [
    ["list"],
    ["json", { outputFile: resolve("test-results/independent-review-results.json") }],
  ],
  use: { baseURL: "http://127.0.0.1:4350", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    env: { PUBLIC_API_MODE: "mock", BARO_UI_TEST_FIXTURE: "true", ASTRO_TELEMETRY_DISABLED: "1" },
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4350",
    url: "http://127.0.0.1:4350/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
