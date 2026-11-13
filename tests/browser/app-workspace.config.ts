import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "app-workspace.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4312", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/app-workspace-server.ts",
    url: "http://127.0.0.1:4312",
    reuseExistingServer: false,
  },
});
