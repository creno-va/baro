import { expect, test } from "bun:test";
import { Hono } from "hono";
import { V2_LIMITS } from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createFilesApi } from "../src/server/api/v2/files";
import { AUTH_RETENTION_MS } from "../src/server/auth/policy";
import { uploaded } from "./helpers/file-processing-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";

for (const change of ["revocation", "expiry", "retention"] as const) {
  test(`original download releases no plaintext after requesting session ${change} during R2 read`, async () => {
    const f = await reportHttpFixture();
    f.db.sqlite
      .query(
        "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) SELECT ?,user_id,?,expires_at,created_at,updated_at FROM session WHERE user_id=? LIMIT 1",
      )
      .run("synthetic-other-session", "synthetic-other-token", f.actor.ownerId);
    f.bucket.setGetHook(async () => {
      if (change === "revocation")
        f.db.sqlite
          .query("DELETE FROM session WHERE user_id=? AND id!='synthetic-other-session'")
          .run(f.actor.ownerId);
      if (change === "expiry")
        f.db.sqlite
          .query(
            "UPDATE session SET expires_at=0 WHERE user_id=? AND id!='synthetic-other-session'",
          )
          .run(f.actor.ownerId);
      if (change === "retention")
        f.db.sqlite
          .query(
            "UPDATE session SET created_at=? WHERE user_id=? AND id!='synthetic-other-session'",
          )
          .run(Date.now() - AUTH_RETENTION_MS - 1000, f.actor.ownerId);
    });
    const path = `/api/v2/cases/${f.workspaceId}/files/${f.selectedFileId}/content`;
    const response = await f.app.request(path, { headers: { cookie: f.cookie } }, f.env);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("synthetic stream missing");
    await expect(reader.read().then(({ done }) => done)).rejects.toThrow("INVALID_FILE");
    reader.releaseLock();
    expect((await f.app.request(path, { headers: { cookie: f.cookie } }, f.env)).status).toBe(
      change === "retention" ? 404 : 401,
    );
  });
}

test("original download stops before fetching the next part when its exact session is revoked", async () => {
  const f = await reportHttpFixture();
  const original = await uploaded(f, new Uint8Array(V2_LIMITS.chunkBytes + 3).fill(65));
  const path = `/api/v2/cases/${f.workspaceId}/files/${original.session.fileId}/content`;
  const response = await f.app.request(path, { headers: { cookie: f.cookie } }, f.env);
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("synthetic stream missing");
  expect((await reader.read()).value?.byteLength).toBe(V2_LIMITS.chunkBytes);
  const reads = f.bucket.calls.get;
  f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
  await expect(reader.read()).rejects.toThrow("INVALID_FILE");
  expect(f.bucket.calls.get).toBe(reads);
  reader.releaseLock();
});

test("current consent is not required to finish an owned original download with a valid session", async () => {
  const f = await reportHttpFixture();
  const path = `/api/v2/cases/${f.workspaceId}/files/${f.selectedFileId}/content`;
  f.bucket.setGetHook(async () => {
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  });
  const response = await f.app.request(path, { headers: { cookie: f.cookie } }, f.env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe(f.original);
  const saved = await f.app.request(path, { headers: { cookie: f.cookie } }, f.env);
  expect(saved.status).toBe(200);
  expect(await saved.text()).toBe(f.original);
});

test("session revoked during the last header decryption cannot release original plaintext", async () => {
  const f = await reportHttpFixture();
  let headers = 0;
  const app = new Hono<ApiEnvironment>().route(
    "/api/v2/cases",
    createFilesApi({
      dependencies: async (_env, core) => {
        const decrypt = core.cipher.decrypt.bind(core.cipher);
        core.cipher.decrypt = async (envelope, context) => {
          const value = await decrypt(envelope, context);
          // Receipt + the single authenticated header read; revocation still
          // happens after decryption and before the final access fence.
          if (context.table === "v2_upload_parts" && ++headers === 2)
            f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
          return value;
        };
        return { ...f.deps, bucket: f.bucketPort };
      },
    }),
  );
  const response = await app.request(
    `/api/v2/cases/${f.workspaceId}/files/${f.selectedFileId}/content`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("synthetic stream missing");
  await expect(reader.read().then(({ done }) => done)).rejects.toThrow("INVALID_FILE");
  reader.releaseLock();
  expect(headers).toBe(2);
});
