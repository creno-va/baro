import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import type { ApiEnvironment } from "../src/server/api/errors";
import { attachmentFilename, createFilesApi } from "../src/server/api/v2/files";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const app = new Hono<ApiEnvironment>()
  .use("*", async (c, next) => {
    c.set("requestId", "synthetic-request");
    await next();
  })
  .route("/v2/cases", createFilesApi());
test("actual signed session, origin and consent deny before any binary body read", async () => {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  let pulled = 0;
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost:4321/v2/cases/case/files/file/parts/0", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-session": "upload",
        ...headers,
      },
      body: new ReadableStream<Uint8Array>(
        {
          pull(c) {
            pulled++;
            c.enqueue(new Uint8Array(100));
            c.close();
          },
        },
        { highWaterMark: 0 },
      ),
    });
  expect(
    (await app.request(request({ origin: owner.env.BETTER_AUTH_URL }), undefined, owner.env))
      .status,
  ).toBe(401);
  expect(
    (
      await app.request(
        request({ cookie: owner.cookie, origin: "https://attacker.test" }),
        undefined,
        owner.env,
      )
    ).status,
  ).toBe(403);
  db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(owner.userId);
  expect(
    (
      await app.request(
        request({ cookie: owner.cookie, origin: owner.env.BETTER_AUTH_URL }),
        undefined,
        owner.env,
      )
    ).status,
  ).toBe(403);
  expect(pulled).toBe(0);
});
test("closed production and authenticated invalid requests have sanitized private responses", async () => {
  const closed = await app.request("/v2/cases/case/files", undefined, {
    APP_ENV: "production",
    PUBLIC_BETA_ENABLED: "false",
  } as Env);
  expect(closed.status).toBe(503);
  expect(closed.headers.get("cache-control")).toBe("private, no-store");
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const bad = await app.request(
    "/v2/cases/case/files?role=admin",
    { headers: { cookie: owner.cookie } },
    env,
  );
  expect(bad.status).toBe(400);
  expect(bad.headers.get("cache-control")).toBe("private, no-store");
  expect(await bad.text()).not.toContain("admin");
  const json = await app.request(
    "/v2/cases/case/files",
    {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin: env.BETTER_AUTH_URL,
        "if-match": "1",
        "idempotency-key": "synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "x.txt",
        byteLength: 5,
        mediaType: "text/plain",
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        probe: { format: "pdf" },
        funding: true,
      }),
    },
    env,
  );
  expect(json.status).toBe(400);
  expect(await json.text()).not.toContain("funding");
});
test("attachment filenames escape punctuation/Unicode and never form executable inline content", () => {
  const header = attachmentFilename('💙"; hostile().txt');
  expect(header).toStartWith("attachment; filename=\"download\"; filename*=UTF-8''");
  expect(header).not.toContain("hostile()");
  expect(header).toContain("%22%3B");
  expect(header).toContain("%F0%9F%92%99");
});
