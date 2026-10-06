import { Hono } from "hono";
import { api } from "../../src/server/api";
import { runPipelineFixture } from "../evals/pipeline";
import corpus from "../fixtures/evals/corpus.json";
import { corpusSchema, type EvalFixture } from "./evals";

// Loopback test executable only. No HTTP seed route or authentication bypass.
const origin = new URL(Bun.argv[2] ?? "http://127.0.0.1:4337");
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.username ||
  origin.password
)
  throw new Error("INVALID_SYNTHETIC_ORIGIN");
const entries: { fixture: EvalFixture; result: Awaited<ReturnType<typeof runPipelineFixture>> }[] =
  [];
for (const fixture of corpusSchema.parse(corpus).fixtures) {
  const result = await runPipelineFixture(fixture, "none", origin.origin);
  if (!result.detail || result.report.findings.length) throw new Error("CRITICAL_EVAL_FAILURE");
  entries.push({ fixture, result });
}
const app = new Hono<{ Bindings: Env }>().route("/api", api);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    const id = pathname.split("/")[3];
    const cookies =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((cookie) => cookie.trim()) ?? [];
    // The customer shell verifies /me/session before reading a legacy case.
    // Choose its isolated SQL database by the signed cookie, then let the native
    // auth/session route validate it. No session response or role is fabricated.
    const entry =
      pathname === "/api/me/session"
        ? (entries.find((e) => cookies.includes(e.result.session.cookie)) ?? entries[0])
        : entries.find((e) => e.result.caseId === id);
    return entry ? app.fetch(request, entry.result.env) : new Response(null, { status: 404 });
  },
});
// Synthetic signed sessions travel over private IPC and never enter artifacts.
console.log(
  JSON.stringify({
    origin: server.url.origin,
    cases: entries.map(({ fixture, result }) => ({
      id: fixture.id,
      version: fixture.version,
      category: fixture.expected.result,
      caseId: result.caseId,
      cookie: result.session.browserCookie,
    })),
  }),
);
process.stdin.resume();
process.stdin.on("end", () => {
  server.stop(true);
  for (const entry of entries) entry.result.db.close();
  process.exit(0);
});
