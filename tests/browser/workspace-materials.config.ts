import { defineConfig } from "@playwright/test";

const external = process.env.BARO_MATERIALS_URL;
const port = "4322";
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-materials.e2e.ts",
  workers: 1,
  timeout: 45000,
  outputDir: "../../.wrangler/ui753/browser",
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    browserName: "chromium",
    trace: "off",
  },
  ...(external
    ? {}
    : {
        webServer: {
          env: {
            PUBLIC_API_MODE: "mock",
            BARO_UI_TEST_FIXTURE: "true",
            ASTRO_TELEMETRY_DISABLED: "1",
          },
          command: `bun run dev -- --ignore-lock --host 127.0.0.1 --port ${port}`,
          url: `http://127.0.0.1:${port}/cases/synthetic-case`,
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
