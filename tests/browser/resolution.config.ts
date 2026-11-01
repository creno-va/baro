import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = process.env.BARO_RESOLUTION_TEST_PORT ?? "4376";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "resolution.e2e.ts",
  workers: 1,
  use: {
    baseURL,
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/resolution-server.ts",
    env: { BARO_RESOLUTION_TEST_PORT: port },
    url: `${baseURL}/fixture/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
