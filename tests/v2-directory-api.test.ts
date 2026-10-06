import { afterEach, expect, test } from "bun:test";
import { createDirectoryApi } from "../src/server/api/v2/directory";
import { createTestDatabase } from "./helpers/d1";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const env = {
    DB: db.binding,
    APP_ENV: "preview",
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
  } as Env;
  return { db, env, api: createDirectoryApi({ clock: () => "2026-10-06T00:00:00.000Z" }) };
}
test("anonymous directory keeps empty supply explicit, rejects unknown filters and never reads cases", async () => {
  const f = await fixture();
  const prepare = f.db.binding.prepare;
  f.db.binding.prepare = (sql) => {
    if (/v2_workspaces|v2_intakes|v2_messages|encrypted_payload/.test(sql))
      throw new Error("private data read");
    return prepare(sql);
  };
  const response = await f.api.request("/?region=jeju&legalField=tax", {}, f.env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ schemaVersion: "2", items: [], nextCursor: null });
  for (const query of [
    "?region=unknown",
    "?limit=51",
    "?caseId=private",
    "?limit=no",
    "?cursor=invalid",
  ]) {
    expect((await f.api.request(`/${query}`, {}, f.env)).status).toBe(400);
  }
  expect((await f.api.request("/not-published", {}, f.env)).status).toBe(404);
});
test("public gate and expired cursors fail without treating missing data as a successful profile", async () => {
  const f = await fixture();
  expect(
    (
      await f.api.request(
        "/",
        {},
        { ...f.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" },
      )
    ).status,
  ).toBe(503);
  const cursor = btoa(JSON.stringify([crypto.randomUUID(), 0]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  expect((await f.api.request(`/?cursor=${cursor}`, {}, f.env)).status).toBe(409);
});
