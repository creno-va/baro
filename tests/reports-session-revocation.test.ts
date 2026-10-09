import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createReportsApi } from "../src/server/api/v2/reports";
import { AUTH_RETENTION_MS } from "../src/server/auth/policy";
import { readyFile } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";

async function prepared(kind: "pdf" | "zip") {
  const f = await reportHttpFixture();
  const selected =
    kind === "zip"
      ? (await readyFile(f, "합성 원본 ".repeat(60000))).session.fileId
      : f.selectedFileId;
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  let id = report.id;
  if (kind === "pdf") {
    const initial = await f.reports.pdf(f.actor.ownerId, id);
    await new Response(initial.body).arrayBuffer();
  } else {
    const initial = await f.reports.zip(f.actor.ownerId, id, crypto.randomUUID(), [selected]);
    await new Response(initial.body).arrayBuffer();
    const loaded = await f.reports.get(f.actor.ownerId, f.workspaceId);
    if (!loaded.savedZip) throw new Error("synthetic stored ZIP missing");
    id = loaded.savedZip.id;
  }
  return { ...f, path: `/api/v2/reports/${id}/${kind}` };
}

for (const kind of ["pdf", "zip"] as const) {
  for (const change of ["revocation", "expiry", "retention", "role"] as const) {
    test(`${kind} stream stops after requesting session ${change} between plaintext chunks`, async () => {
      const f = await prepared(kind);
      const response = await f.app.request(f.path, { headers: { cookie: f.cookie } }, f.env);
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("stream missing");
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(first.value?.byteLength).toBeGreaterThan(0);
      // Keep a second active session for this owner: checking only owner presence is insufficient.
      f.db.sqlite
        .query(
          "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) SELECT ?,user_id,?,expires_at,created_at,updated_at FROM session WHERE user_id=? LIMIT 1",
        )
        .run("synthetic-other-session", "synthetic-other-token", f.actor.ownerId);
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
      if (change === "role")
        f.db.sqlite
          .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
          .run(`account-type:${f.actor.ownerId}`);
      const remaining = async () => {
        while (!(await reader.read()).done) {
          /* Drain until revoked. */
        }
      };
      await expect(remaining()).rejects.toThrow();
      expect(
        (await f.app.request(f.path, { headers: { cookie: f.cookie } }, f.env)).status,
      ).not.toBe(200);
      reader.releaseLock();
    });
  }
}

for (const change of ["revocation", "role"] as const) {
  test(`HTML denies ${change} after initial signed access and before saved content is read`, async () => {
    const f = await reportHttpFixture();
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const app = new Hono<ApiEnvironment>().route(
      "/api/v2",
      createReportsApi({
        testOnlyMissingD1Meta: true,
        dependencies: async () => {
          if (change === "revocation")
            f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
          else
            f.db.sqlite
              .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
              .run(`account-type:${f.actor.ownerId}`);
          return f.deps;
        },
      }),
    );
    const response = await app.request(
      `/api/v2/reports/${report.id}/html`,
      { headers: { cookie: f.cookie } },
      f.env,
    );
    expect(response.status).not.toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
}

test("new PDF generation stops before storage if its requesting session is revoked while loading the font", async () => {
  const f = await reportHttpFixture();
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const objects = f.bucket.objects.size;
  const app = new Hono<ApiEnvironment>().route(
    "/api/v2",
    createReportsApi({
      testOnlyMissingD1Meta: true,
      dependencies: async () => ({
        ...f.deps,
        font: async () => {
          const bytes = await f.deps.font();
          f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
          return bytes;
        },
      }),
    }),
  );
  const response = await app.request(
    `/api/v2/reports/${report.id}/pdf`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(response.status).not.toBe(200);
  expect(f.bucket.objects.size).toBe(objects);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_reports WHERE pdf_blob_id IS NOT NULL").get(),
  ).toEqual({ n: 0 });
});

test("session-bound export fence still uses one SQL query per check", async () => {
  const { exportFence } = await import("../src/server/modules/reports/fence");
  const { sourceDigest } = await import("../src/server/modules/reports/source");
  const f = await reportHttpFixture();
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const row = f.db.sqlite.query("SELECT * FROM v2_reports WHERE id=?").get(report.id) as {
    id: string;
    revision: number;
    workspace_id: string;
    snapshot_id: string;
    encrypted_payload: string;
  };
  const session = f.db.sqlite
    .query("SELECT id FROM session WHERE user_id=?")
    .get(f.actor.ownerId) as { id: string };
  const fence = await exportFence(
    f.core,
    f.actor,
    row,
    await sourceDigest(f.core, f.actor, f.workspaceId),
    () => f.actor.now,
    session.id,
  );
  let before = f.db.queryCount;
  await fence.check();
  expect(f.db.queryCount - before).toBe(1);
  f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
  before = f.db.queryCount;
  await expect(fence.check()).rejects.toThrow("STALE_REVISION");
  expect(f.db.queryCount - before).toBe(1);
});

test("session revoked during report encryption cannot publish a new report or operation", async () => {
  const { createReportsService } = await import("../src/server/modules/reports/service");
  const f = await reportHttpFixture();
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const revision = f.rev();
  const session = f.db.sqlite
    .query("SELECT id FROM session WHERE user_id=?")
    .get(f.actor.ownerId) as { id: string };
  let revoked = false;
  const raced = createReportsService(
    {
      ...f.core,
      encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
        const encrypted = await f.core.encrypt(...args);
        if (!revoked && args[0] === "v2_reports") {
          revoked = true;
          f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
        }
        return encrypted;
      },
    },
    { ...f.deps, sessionId: session.id },
  );
  await expect(
    raced.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: first.revision,
      content: "저장 중 로그아웃한 합성 내용",
      maskIdentifiers: true,
      excludedFileIds: [],
    }),
  ).rejects.toThrow();
  expect(revoked).toBe(true);
  expect(f.rev()).toBe(revision);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get()).toEqual({ n: 1 });
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_operations WHERE kind='report'").get(),
  ).toEqual({ n: 1 });
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(first.content);
});
