import { defineConfig } from "@playwright/test";
import integration from "./integration.config";
export default defineConfig({ ...integration, testMatch: "human-review.e2e.ts", timeout: 45000 });
