import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "mobile-challenge.e2e.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4440", browserName: "chromium", trace: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "bun tests/helpers/mobile-challenge-server.ts",
    url: "http://127.0.0.1:4440/api/mobile/challenge?attemptId=71e770bb-933a-450a-9fe3-512710a708bc",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
