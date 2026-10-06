import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const app = new Hono<ApiEnvironment>().route("/api", api);

test("actual Worker binary route denies unauthorized streams without pulling any bytes", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  let pulls = 0;
  const response = await app.request(
    new Request("http://localhost:4321/api/v2/cases/case/files/file/parts/0", {
      method: "PUT",
      headers: { origin: owner.env.BETTER_AUTH_URL, "content-type": "application/octet-stream" },
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(100_000));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    }),
    undefined,
    owner.env,
  );
  expect(response.status).toBe(401);
  expect(pulls).toBe(0);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

test("production closed route and oversized metadata remain private and bounded", async () => {
  const closed = await app.request("/api/v2/cases/case/files", undefined, {
    APP_ENV: "production",
    PUBLIC_BETA_ENABLED: "false",
  } as Env);
  expect(closed.status).toBe(503);
  expect(closed.headers.get("cache-control")).toBe("private, no-store");
  expect(await closed.json()).toMatchObject({ error: { code: "BETA_NOT_OPEN" } });
  const tooLarge = await app.request(
    "/api/v2/cases/case/files",
    {
      method: "POST",
      body: new Uint8Array(70_000),
      headers: { "content-length": "70000" },
    },
    { APP_ENV: "preview" } as Env,
  );
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.headers.get("cache-control")).toBe("private, no-store");
});
