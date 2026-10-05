import { Hono } from "hono";
import { api } from "../../src/server/api";
import { createCaseApi } from "../../src/server/api/case-create";
import { syntheticWorkflow } from "../adapters/analysis-pipeline";
import { createTestDatabase } from "./d1";
import { seedTestSession } from "./session";

// This executable is only launched by Playwright. Product code never imports this module.
// No seed/auth-bypass endpoint exists. All HTTP requests use real Hono middleware.
const browserOrigin = new URL(Bun.argv[2] ?? "http://127.0.0.1:4337");
if (
  browserOrigin.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(browserOrigin.hostname) ||
  browserOrigin.username ||
  browserOrigin.password ||
  browserOrigin.pathname !== "/"
)
  throw new Error("Synthetic browser harness requires a loopback HTTP origin");
const database = await createTestDatabase();
const caseMode = ["cases", "analysis"].includes(Bun.argv[3] ?? "");
const session = await seedTestSession(database, { consent: caseMode });
session.env.BETTER_AUTH_URL = browserOrigin.origin;
session.browserCookie.url = browserOrigin.origin;
session.env.CASE_DATA_KEY_V1 = btoa("x".repeat(32)).replace(/=+$/, "");
session.env.CASE_ACCOUNT_LIMIT = { limit: async () => ({ success: true }) } as RateLimit;
session.env.CASE_IP_LIMIT = { limit: async () => ({ success: true }) } as RateLimit;
session.env.ANALYSIS_ACCOUNT_LIMIT = { limit: async () => ({ success: true }) } as RateLimit;
if (Bun.argv[3] === "analysis")
  session.env.ANALYSIS_WORKFLOW = await syntheticWorkflow(session.env);
const app = new Hono<{ Bindings: Env }>();
if (caseMode)
  app.route(
    "/api/cases",
    createCaseApi(async () => true),
  );
app.route("/api", api);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return app.fetch(request, session.env);
  },
});
// IPC only contains a synthetic session; Playwright never attaches it to artifacts.
console.log(JSON.stringify({ origin: server.url.origin, cookie: session.browserCookie }));
process.stdin.resume();
process.stdin.on("end", () => {
  server.stop(true);
  database.close();
  process.exit(0);
});
