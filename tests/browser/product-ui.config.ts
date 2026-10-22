import { defineConfig } from "@playwright/test";
import integration from "./integration.config";

process.env.PUBLIC_API_MODE = "mock";
export default defineConfig({
  ...integration,
  testMatch: "product-ui.e2e.ts",
  timeout: 60000,
});
