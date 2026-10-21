import { defineConfig } from "@playwright/test";
import integration from "./integration.config";
export default defineConfig({ ...integration, testMatch: "precedents.e2e.ts" });
