import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createFilesApi } from "../src/server/api/v2/files";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { readWorkspaceFile } from "../src/server/modules/files/workspace-read";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
test("workspace file observations read requires exact owner and workspace and stops after deletion", async () => {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true }),
    other = await seedTestSession(db, { consent: true });
  const core = createV2Core(
    db.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("f".repeat(32)).replace(/=+$/, "") }),
  );
  const now = new Date().toISOString(),
    actor = { ownerId: owner.userId, now };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID(),
    siblingId = crypto.randomUUID();
  for (const id of [workspaceId, siblingId]) {
    const envelope = await core.encrypt("v2_workspaces", id, owner.userId, 1, {
      subjectContext: "individual",
      jurisdiction: "KR",
    });
    db.sqlite
      .query(
        "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
      )
      .run(id, owner.userId, envelope, now, now);
    db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(id);
  }
  const fileId = crypto.randomUUID();
  const files = createV2FilesRepository(core);
  expect(
    await files.reserve(
      { ...actor, workspaceId, expectedRevision: 1 },
      {
        name: "synthetic.txt",
        byteLength: 10,
        mediaType: "text/plain",
        autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
      },
      {
        fileId,
        uploadId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        consentId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: "a".repeat(64),
        },
      },
    ),
  ).not.toBeNull();
  const own = await readWorkspaceFile(core, owner.userId, workspaceId, fileId);
  expect(own.name).toBe("synthetic.txt");
  expect(own.status).toBe("reserved");
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-resume");
      await next();
    })
    .route("/v2/cases", createFilesApi());
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("f".repeat(32)).replace(/=+$/, "") };
  const route = `/v2/cases/${workspaceId}/files/${fileId}/upload-session`;
  expect((await app.request(route, {}, env)).status).toBe(401);
  expect((await app.request(route, { headers: { cookie: other.cookie } }, env)).status).toBe(404);
  expect(
    (
      await app.request(
        `/v2/cases/${siblingId}/files/${fileId}/upload-session`,
        {
          headers: { cookie: owner.cookie },
        },
        env,
      )
    ).status,
  ).toBe(404);
  const resumed = await app.request(route, { headers: { cookie: owner.cookie } }, env);
  expect(resumed.status).toBe(200);
  expect(((await resumed.json()) as { fileId: string }).fileId).toBe(fileId);
  expect(resumed.headers.get("cache-control")).toBe("private, no-store");
  const detail = await app.request(
    `/v2/cases/${workspaceId}/files/${fileId}`,
    {
      headers: { cookie: owner.cookie },
    },
    env,
  );
  expect(detail.status).toBe(200);
  expect(((await detail.json()) as { name: string }).name).toBe("synthetic.txt");
  db.sqlite
    .query("UPDATE v2_upload_sessions SET expires_at=? WHERE file_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), fileId);
  expect((await app.request(route, { headers: { cookie: owner.cookie } }, env)).status).toBe(404);
  db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(owner.userId);
  expect((await app.request(route, { headers: { cookie: owner.cookie } }, env)).status).toBe(403);
  await expect(readWorkspaceFile(core, other.userId, workspaceId, fileId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(readWorkspaceFile(core, owner.userId, siblingId, fileId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  db.sqlite.query("DELETE FROM v2_files WHERE id=?").run(fileId);
  await expect(readWorkspaceFile(core, owner.userId, workspaceId, fileId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
