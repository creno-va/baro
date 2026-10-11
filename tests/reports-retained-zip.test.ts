import { expect, test } from "bun:test";
import { createReportsApi } from "../src/client/api/reports";
import { readyFile } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

async function fixture() {
  const f = await reportHttpFixture();
  const request = async (path: string, init?: RequestInit) => {
    const response = await f.app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.cookie,
          origin: f.env.BETTER_AUTH_URL,
        },
      },
      f.env,
    );
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  };
  const client = createReportsApi(request),
    report = await client.get(f.workspaceId);
  const first = await client.zip(report.id, [f.selectedFileId]);
  const reloaded = await client.get(f.workspaceId);
  expect(reloaded.savedZip).toMatchObject({ fileCount: 1, createdAt: f.actor.now });
  if (!reloaded.savedZip) throw new Error("saved ZIP missing");
  return { ...f, client, request, report, first, archiveId: reloaded.savedZip.id };
}

test("saved ZIP survives changed sources, expired replay keys and re-consent without generating another artifact", async () => {
  const f = await fixture(),
    bytes = await f.first.arrayBuffer();
  await readyFile(f, "새 합성 자료");
  f.db.sqlite.query("DELETE FROM v2_idempotency WHERE owner_id=?").run(f.actor.ownerId);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  const records = f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get(),
    objects = f.bucket.objects.size;
  const reloaded = await createReportsApi(f.request).get(f.workspaceId);
  expect(reloaded.stale).toBe(true);
  expect(reloaded.savedZip?.id).toBe(f.archiveId);
  const response = await f.request(`/api/v2/reports/${f.archiveId}/zip`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8");
  expect(await response.arrayBuffer()).toEqual(bytes);
  expect(f.bucket.objects.size).toBe(objects);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get()).toEqual(records);
  await expect(f.client.zip(f.report.id, [f.selectedFileId])).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
});

test("stored ZIP GET rejects anonymous, expired sessions, other owners, wrong roles and non-export report IDs", async () => {
  const f = await fixture(),
    path = `/api/v2/reports/${f.archiveId}/zip`;
  const peer = await seedTestSession(f.db, { consent: true });
  expect((await f.app.request(path, {}, f.env)).status).toBe(401);
  expect((await f.app.request(path, { headers: { cookie: peer.cookie } }, f.env)).status).toBe(404);
  expect((await f.request(`/api/v2/reports/${f.report.id}/zip`)).status).toBe(404);
  f.db.sqlite
    .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  expect((await f.request(path)).status).toBe(403);
  f.db.sqlite
    .query("UPDATE app_metadata SET value='customer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  f.db.sqlite.query("UPDATE session SET expires_at=0 WHERE user_id=?").run(f.actor.ownerId);
  expect((await f.request(path)).status).toBe(401);
});

for (const change of ["role", "file", "report", "workspace", "account"] as const) {
  test(`stored ZIP stream stops after ${change} changes before consumption`, async () => {
    const f = await fixture();
    const late = await f.reports.savedZip(f.actor.ownerId, f.archiveId);
    if (change === "role")
      f.db.sqlite
        .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
        .run(`account-type:${f.actor.ownerId}`);
    if (change === "file")
      f.db.sqlite.query("DELETE FROM v2_files WHERE id=?").run(f.selectedFileId);
    if (change === "report")
      f.db.sqlite.query("DELETE FROM v2_reports WHERE id=?").run(f.report.id);
    if (change === "workspace")
      f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.workspaceId);
    if (change === "account") f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
    await expect(new Response(late.body).arrayBuffer()).rejects.toThrow();
    expect((await f.request(`/api/v2/reports/${f.archiveId}/zip`)).status).not.toBe(200);
  });
}

test("latest saved ZIP stays tied to its report revision while older packages retain their exact selection", async () => {
  const f = await fixture(),
    oldBytes = await f.first.arrayBuffer();
  const files = (await f.service.list(f.actor.ownerId, f.workspaceId)).filter(
    (file) => file.id !== f.selectedFileId,
  );
  if (!files[0]) throw new Error("second original missing");
  await f.client.zip(f.report.id, [f.selectedFileId, files[0].id]);
  const refreshed = await f.client.get(f.workspaceId);
  expect(refreshed.savedZip?.fileCount).toBe(2);
  expect(refreshed.savedZip?.id).not.toBe(f.archiveId);
  expect(await (await f.client.savedZip(f.archiveId)).arrayBuffer()).toEqual(oldBytes);
  const next = await f.client.generate(f.workspaceId);
  expect(next.savedZip).toBeUndefined();
  expect(await (await f.client.savedZip(f.archiveId)).arrayBuffer()).toEqual(oldBytes);
});
