import { Hono } from "hono";
import type { ApiEnvironment } from "../../src/server/api/errors";
import { meApi } from "../../src/server/api/me";
import { createFilesApi } from "../../src/server/api/v2/files";
import { createWorkspacesApi } from "../../src/server/api/v2/workspaces";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./customer-workspace";
import { seedTestSession } from "./session";

// Loopback-only harness. Real Hono/session/encryption/mutations, synthetic model seed.
const browserOrigin = Bun.argv[2] ?? "http://127.0.0.1:4355";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(browserOrigin)) throw new Error("Loopback only");
const f = await customerWorkspaceFixture();
const foreign = await seedTestSession(f.db, { consent: true });
await runCustomerJob(f, "intake_questions");
const intake = await f.service.intake(f.owner.userId, f.workspace.id);
await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
  expectedRevision: intake?.revision,
  answers: intake?.batches[0]?.questions.map((question) => ({
    questionId: question.id,
    status: "unknown",
  })),
});
await runCustomerJob(f, "intake_summary");
if (Bun.argv[3] === "pending-chat-summary") {
  await confirmCustomerSummary(f);
  await runCustomerJob(f, "chat_response");
}
const env: Env = {
  ...f.owner.env,
  BETTER_AUTH_URL: browserOrigin,
  CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
};
const app = new Hono<ApiEnvironment>()
  .route("/api/me", meApi)
  .route("/api/v2/cases", createWorkspacesApi())
  .route("/api/v2/cases", createFilesApi());
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => app.fetch(request, env),
});
console.log(
  JSON.stringify({
    origin: server.url.origin,
    id: f.workspace.id,
    ownerCookie: { ...f.owner.browserCookie, url: browserOrigin },
    foreignCookie: { ...foreign.browserCookie, url: browserOrigin },
  }),
);
process.stdin.resume();
process.stdin.on("end", () => {
  server.stop(true);
  f.db.close();
  process.exit(0);
});
