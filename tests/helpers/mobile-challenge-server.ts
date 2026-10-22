// Synthetic browser harness serves the product Hono HTML/CSP, without Astro or external credentials.
import { Hono } from "hono";
import { createMobileChallengeApi } from "../../src/server/api/mobile-challenge";

const app = new Hono().route(
  "/api/mobile",
  createMobileChallengeApi({ siteKey: "synthetic-site-key" }),
);
Bun.serve({ hostname: "127.0.0.1", port: 4440, fetch: app.fetch });
