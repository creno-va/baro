import { defineConfig } from "@playwright/test";
import headless from "./headless-ui.config";
export default defineConfig({
  ...headless,
  testMatch: "theme-palette.e2e.ts",
  outputDir: "../../.wrangler/ui799/palette",
});
