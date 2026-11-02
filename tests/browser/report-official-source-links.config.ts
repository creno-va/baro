import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "report-official-source-links.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4436", trace: "off" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/report-official-source-server.ts",
    url: "http://127.0.0.1:4436",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
