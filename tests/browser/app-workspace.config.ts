import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = process.env.BARO_SHELL_FIXTURE_PORT ?? "4312";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("INVALID_BROWSER_TEST_PORT");

export default defineConfig({
  testDir: ".",
  testMatch: "app-workspace.e2e.ts",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/app-workspace-server.ts",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
