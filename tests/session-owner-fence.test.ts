import { afterEach, expect, test } from "bun:test";
import { createCasesClient, createJsonRequester, type OperationRequest } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const a = await seedTestSession(db, { consent: true }),
    b = await seedTestSession(db, { consent: true });
  let admissions = 0;
  const app = new Hono<ApiEnvironment>().route("/api/me", meApi).route(
    "/api/v2/cases",
    createWorkspacesApi({
      dependencies: async () => {
        admissions++;
        throw new Error("SYNTHETIC_ADMISSION_NOT_EXPECTED");
      },
      turnstile: async () => {
        throw new Error("SYNTHETIC_PROVIDER_NOT_EXPECTED");
      },
    }),
  );
  return { db, a, b, app, admissions: () => admissions };
}

test("an owner hint can only deny a stale intent; it cannot grant or revoke another session", async () => {
  const f = await fixture();
  for (const hint of [f.a.userId, "%", "", "a".repeat(1537)]) {
    const response = await f.app.request(
      "/api/me/session",
      { headers: { cookie: f.b.cookie, [EXPECTED_OWNER_HEADER]: hint } },
      f.b.env,
    );
    expect(((await response.json()) as { user: unknown }).user).toBeNull();
  }
  const live = await f.app.request(
    "/api/me/session",
    { headers: { cookie: f.b.cookie, [EXPECTED_OWNER_HEADER]: encodeURIComponent(f.b.userId) } },
    f.b.env,
  );
  expect(((await live.json()) as { user: { id: string } }).user.id).toBe(f.b.userId);
  const anonymous = await f.app.request(
    "/api/me/session",
    { headers: { [EXPECTED_OWNER_HEADER]: f.b.userId } },
    f.b.env,
  );
  expect(((await anonymous.json()) as { user: unknown }).user).toBeNull();
  const normal = await f.app.request(
    "/api/me/session",
    { headers: { cookie: f.b.cookie } },
    f.b.env,
  );
  expect(((await normal.json()) as { user: { id: string } }).user.id).toBe(f.b.userId);
});

test("a cookie change during case challenge cannot admit the previous owner's narrative into the new account", async () => {
  const f = await fixture();
  let cookie = f.a.cookie,
    release!: (token: string) => void,
    entered!: () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  const records = new Map<string, string>();
  const request = createJsonRequester({
    newKey: () => crypto.randomUUID(),
    transport: async (path, init) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      headers.set("origin", f.a.env.BETTER_AUTH_URL);
      return f.app.request(path, { ...init, headers }, f.a.env);
    },
  });
  const operation: OperationRequest = (_action, _input, options = {}) =>
    request({ ...options, path: options.path ?? "/invalid" });
  const cases = createCasesClient({
    request: operation,
    scope: createSessionScope(),
    mode: "real",
    persistence: "required",
    newKey: () => crypto.randomUUID(),
    fingerprint: async () => "a".repeat(64),
    storage: {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => {
        records.set(key, value);
      },
      removeItem: (key) => {
        records.delete(key);
      },
    },
    challenge: () => {
      entered();
      return new Promise<string>((done) => {
        release = done;
      });
    },
  });
  const input = {
    narrative: "계정 전환 뒤 이전 사용자 내용을 새 계정에 저장하지 않는 합성 검사입니다.",
    subjectContext: "individual" as const,
  };
  const pending = cases.create(input);
  void pending.catch(() => {});
  await ready;
  // No scope event has arrived yet: the browser's ambient cookie changes first.
  cookie = f.b.cookie;
  release("synthetic-challenge");
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.admissions()).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 0 });
  expect(records.size).toBe(1);
  expect(JSON.stringify([...records])).not.toContain(input.narrative);
});
