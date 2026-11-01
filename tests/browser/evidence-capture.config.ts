import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "evidence-capture.e2e.ts",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4364", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/evidence-ui-server.ts",
    env: { BARO_EVIDENCE_TEST_PORT: "4364" },
    url: "http://127.0.0.1:4364",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
