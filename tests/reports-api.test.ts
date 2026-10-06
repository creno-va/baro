import { expect, test } from "bun:test";
import { createReportsApi } from "../src/client/api/reports";
import type { ReportView } from "../src/client/api/types";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

test("real signed SQL routes and client adapter save immutable review then return decrypted PDF/ZIP attachment streams", async () => {
  const f = await reportHttpFixture(),
    base = `/api/v2/cases/${f.workspaceId}/reports`;
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
    // Materialize serialized wire headers: Hono mutates response headers after
    // construction; Bun's in-process blob() caches the initial MIME instead.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  };
  const client = createReportsApi(request),
    report = await client.get(f.workspaceId);
  const saved = await client.save(f.workspaceId, {
    content: "다운로드할 합성 한글 내용 010-1234-5678",
    maskIdentifiers: true,
    excludedFileIds: [],
  });
  expect(saved.revision).toBe(report.revision + 1);
  const pdf = await client.pdf(saved.id),
    zip = await client.zip(saved.id, [f.selectedFileId]);
  expect(pdf.type).toBe("application/pdf");
  expect(zip.type).toBe("application/zip");
  const response = await request(`/api/v2/reports/${saved.id}/pdf`);
  expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''BARO-");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await response.arrayBuffer()).byteLength).toBe(
    Number(response.headers.get("content-length")),
  );
  expect(
    (
      await request(base, {
        method: "PATCH",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          expectedRevision: 1,
          content: "older",
          excludedFileIds: [],
          maskIdentifiers: false,
        }),
      })
    ).status,
  ).toBe(409);
  const peer = await seedTestSession(f.db, { consent: true });
  expect(
    (
      await f.app.request(
        `/api/v2/reports/${saved.id}/pdf`,
        { headers: { cookie: peer.cookie } },
        f.env,
      )
    ).status,
  ).toBe(404);
  expect((await f.app.request(`/api/v2/reports/${saved.id}/pdf`, {}, f.env)).status).toBe(401);
  f.db.sqlite
    .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  expect((await request(base)).status).toBe(403);
  expect((await request(`/api/v2/reports/${saved.id}/pdf`)).status).toBe(403);
  f.db.sqlite
    .query("UPDATE app_metadata SET value='customer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  expect(
    (
      await f.app.request(
        base,
        {
          method: "PATCH",
          headers: { cookie: f.cookie, origin: "https://other.example" },
          body: "{}",
        },
        f.env,
      )
    ).status,
  ).toBe(403);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  expect((await request(`/api/v2/reports/${saved.id}/pdf`)).status).toBe(403);
});
test("closed public gate, duplicate selection and JSON stream size fail with safe responses", async () => {
  const f = await reportHttpFixture(),
    report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const path = `/api/v2/reports/${report.id}/zip`;
  const response = await f.app.request(
    path,
    {
      method: "POST",
      headers: {
        cookie: f.cookie,
        origin: f.env.BETTER_AUTH_URL,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ selectedFileIds: [f.selectedFileId, f.selectedFileId] }),
    },
    f.env,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(f.selectedFileId);
  expect(
    (
      await f.app.request(
        `/api/v2/reports/${report.id}/pdf`,
        { headers: { cookie: f.cookie } },
        { ...f.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" },
      )
    ).status,
  ).toBe(503);
  const large = await f.app.request(
    `/api/v2/cases/${f.workspaceId}/reports`,
    {
      method: "PATCH",
      headers: { cookie: f.cookie, origin: f.env.BETTER_AUTH_URL },
      body: "x".repeat(131073),
    },
    f.env,
  );
  expect(large.status).toBe(413);
  const post = await f.app.request(
    `/api/v2/cases/${f.workspaceId}/reports`,
    {
      method: "POST",
      headers: { cookie: f.cookie, origin: f.env.BETTER_AUTH_URL },
      body: "x".repeat(65537),
    },
    f.env,
  );
  expect(post.status).toBe(413);
});

test("signed SQL report review preserves 30,000 Korean characters above the generic JSON limit", async () => {
  const f = await reportHttpFixture();
  try {
    const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const content = "한".repeat(30000);
    const body = JSON.stringify({
      expectedRevision: report.revision,
      content,
      maskIdentifiers: false,
      excludedFileIds: [],
    });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(65536);
    const calls = { ...f.bucket.calls };
    const key = crypto.randomUUID();
    const headers = {
      cookie: f.cookie,
      origin: f.env.BETTER_AUTH_URL,
      "content-type": "application/json",
      "idempotency-key": key,
    };
    const response = await f.app.request(
      `/api/v2/cases/${f.workspaceId}/reports`,
      {
        method: "PATCH",
        headers,
        body,
      },
      f.env,
    );
    expect(response.status).toBe(200);
    const saved = (await response.json()) as ReportView;
    expect(saved).toMatchObject({ content, revision: report.revision + 1 });
    const replay = await f.app.request(
      `/api/v2/cases/${f.workspaceId}/reports`,
      { method: "PATCH", headers, body },
      f.env,
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()) as ReportView).toEqual(saved);
    const conflict = await f.app.request(
      `/api/v2/cases/${f.workspaceId}/reports`,
      {
        method: "PATCH",
        headers,
        body: body.replace("한".repeat(30000), `${"한".repeat(29999)}글`),
      },
      f.env,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(content);
    expect(f.bucket.calls).toEqual(calls);
  } finally {
    f.db.close();
  }
});
