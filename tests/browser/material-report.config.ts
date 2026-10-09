import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["report-real-download.e2e.ts", "report-retained-pdf.e2e.ts"],
  workers: 1,
  use: { browserName: "chromium", trace: "off" },
});
