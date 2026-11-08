import { defineConfig } from "@playwright/test";
import integration from "./integration.config";

process.env.PUBLIC_API_MODE = "mock";
export default defineConfig({
  ...integration,
  testMatch: ["app-workspace-app.e2e.ts", "app-workspace-public.evidence.ts"],
  timeout: 60000,
});
