import { Hono } from "hono";
import type { ApiEnvironment } from "../../src/server/api/errors";
import { meApi } from "../../src/server/api/me";
import { requestBodyLimit } from "../../src/server/api/request-body-limit";
import { createFilesApi } from "../../src/server/api/v2/files";
import { createReportsApi } from "../../src/server/api/v2/reports";
import { createFilesService } from "../../src/server/modules/files/service";
import { signedSessionCookie, testEnvironment } from "./d1";
import { readyFile, reportFixture } from "./report-fixture";

export async function reportHttpFixture() {
  const f = await reportFixture();
  const original = "선택한 한글 합성 원본 010-1234-5678";
  const selected = await readyFile(f, original);
  await readyFile(f, "선택하지 않은 합성 원본");
  const env = {
    ...testEnvironment(f.db.binding),
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    APP_ENV: "preview",
  };
  f.db.sqlite
    .query("UPDATE session SET expires_at=? WHERE user_id=?")
    .run(Date.now() + 3600000, f.actor.ownerId);
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
    .run(`account-type:${f.actor.ownerId}`, "customer", f.actor.now);
  const token = f.db.sqlite
    .query("SELECT token FROM session WHERE user_id=?")
    .get(f.actor.ownerId) as { token: string };
  const cookie = await signedSessionCookie(token.token, env.BETTER_AUTH_SECRET);
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-report");
      await next();
    })
    .use("*", requestBodyLimit)
    .route("/api/me", meApi)
    .route(
      "/api/v2/cases",
      createFilesApi({
        dependencies: async () => ({
          ...f.deps,
          bucket: f.bucketPort,
          probe: async () => {
            throw new Error("Native processing not composed by report-only fixture");
          },
        }),
      }),
    )
    .route(
      "/api/v2",
      createReportsApi({
        testOnlyMissingD1Meta: true,
        dependencies: async (_, core) => ({
          ...f.deps,
          files: createFilesService(core, {
            environment: "preview",
            bucket: f.bucketPort,
            clock: () => f.actor.now,
            testOnlyUnmeteredStorage: true,
          }),
        }),
      }),
    );
  return { ...f, env, cookie, app, selectedFileId: selected.session.fileId, original };
}
