import { defineConfig } from "@playwright/test";
import materials from "./workspace-materials.config";
export default defineConfig({
  ...materials,
  testMatch: "headless-ui.e2e.ts",
  timeout: 90000,
  outputDir: "../../.wrangler/ui799/browser",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
