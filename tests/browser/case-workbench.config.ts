import { defineConfig } from "@playwright/test";
import materials from "./workspace-materials.config";

export default defineConfig({
  ...materials,
  testMatch: "case-workbench.e2e.ts",
  outputDir: "../../.wrangler/ui795/browser",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
