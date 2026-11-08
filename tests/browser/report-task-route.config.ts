import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = process.env.BARO_REPORT_TASK_ROUTE_PORT ?? "4590";
const baseURL = process.env.BARO_REPORT_TASK_ROUTE_URL ?? `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "report-task-route.e2e.ts",
  workers: 1,
  timeout: 45000,
  use: { baseURL, trace: "off" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  ...(process.env.BARO_REPORT_TASK_ROUTE_URL
    ? {}
    : {
        webServer: {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command: `node node_modules/astro/bin/astro.mjs dev --ignore-lock --host 127.0.0.1 --port ${port}`,
          env: {
            PUBLIC_API_MODE: "mock",
            BARO_UI_TEST_FIXTURE: "true",
            ASTRO_TELEMETRY_DISABLED: "1",
          },
          url: `${baseURL}/cases/synthetic-case/reports`,
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
