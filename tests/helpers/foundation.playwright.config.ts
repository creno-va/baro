import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../browser",
  testMatch: ["design-foundation.e2e.ts", "design-system.e2e.ts", "dialog-focus.e2e.ts"],
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4591", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    cwd: new URL("../..", import.meta.url).pathname,
    command: "node node_modules/astro/bin/astro.mjs dev --ignore-lock --host 127.0.0.1 --port 4591",
    env: {
      BARO_UI_TEST_FIXTURE: "true",
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
    url: "http://127.0.0.1:4591/__design-foundation",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
