import { Hono } from "hono";
import { api } from "../../src/server/api";
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
const session = await seedTestSession(database);
session.env.BETTER_AUTH_URL = browserOrigin.origin;
session.browserCookie.url = browserOrigin.origin;
const app = new Hono<{ Bindings: Env }>().route("/api", api);
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
