import { defineConfig } from "@playwright/test";
import headless from "./headless-ui.config";
export default defineConfig({
  ...headless,
  testMatch: "media-player.e2e.ts",
  outputDir: "../../.wrangler/ui799/media",
});
