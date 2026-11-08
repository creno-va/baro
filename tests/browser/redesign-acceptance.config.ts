import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const external = process.env.BARO_REDESIGN_URL;
export default defineConfig({
  testDir: ".",
  testMatch: "redesign-acceptance.e2e.ts",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 7000 },
  outputDir: process.env.BARO_REDESIGN_OUTPUT_DIR ?? "../../.wrangler/redesign-acceptance",
  metadata: {
    inspectedProductSha:
      process.env.BARO_REDESIGN_SHA ??
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    synthetic: true,
    provider: "explicit local mock; no OAuth, model, legal provider, or remote storage acceptance",
    testSourceSha256: createHash("sha256")
      .update(readFileSync(new URL("./redesign-acceptance.e2e.ts", import.meta.url)))
      .digest("hex"),
  },
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: process.env.BARO_REDESIGN_RESULTS ?? "../../.wrangler/redesign-results.json" },
    ],
  ],
  use: {
    baseURL: external ?? "http://127.0.0.1:4385",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    reducedMotion: "reduce",
    actionTimeout: 10000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          env: {
            PUBLIC_API_MODE: "mock",
            BARO_UI_TEST_FIXTURE: "true",
            ASTRO_TELEMETRY_DISABLED: "1",
            WRANGLER_LOG_PATH: "/private/tmp/baro-redesign-acceptance-wrangler.log",
          },
          command:
            "node node_modules/astro/bin/astro.mjs dev --ignore-lock --host 127.0.0.1 --port 4385",
          url: "http://127.0.0.1:4385/login",
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
