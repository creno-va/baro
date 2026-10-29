import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { saveAccountType } from "../src/server/auth/account-type";
import { SESSION_EXPIRES_SECONDS } from "../src/server/auth/policy";
import { countD1Calls } from "./helpers/d1-call-count";
import { readyFile } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

/** Real Hono/client/AES/SQLite; provider and R2 remain explicit offline adapters. */
async function fixture() {
  const f = await reportHttpFixture();
  // Measure ordinary workspace reads separately from session sliding refresh.
  // The report fixture's one-hour expiry would force concurrent refresh writes.
  const sessionNow = Date.now();
  f.db.sqlite
    .query("UPDATE session SET expires_at=?,updated_at=? WHERE user_id=?")
    .run(sessionNow + SESSION_EXPIRES_SECONDS * 1000, sessionNow, f.actor.ownerId);
  f.app.route("/api/v2/cases", createWorkspacesApi());
  for (let i = 0; i < 5; i++) await readyFile(f, `합성 자료 ${i}`);
  const rows: {
    metadata: boolean;
    coverage: boolean;
    work: { calls: number; statements: number };
  }[] = [];
  let afterMetadata: (() => Promise<void> | void) | undefined;
  const transport = async (path: string, init?: RequestInit) => {
    const meter = countD1Calls(f.db.binding),
      metadata = path.endsWith("/files");
    rows.push({ metadata, coverage: path.endsWith("?view=coverage"), work: meter.work });
    const response = await f.app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.cookie,
          origin: new URL(f.env.BETTER_AUTH_URL).origin,
        },
      },
      { ...f.env, DB: meter.binding },
    );
    if (metadata) await afterMetadata?.();
    return response;
  };
  return {
    ...f,
    rows,
    transport,
    client: createWorkspaceApi(transport, null),
    reset: () => {
      rows.length = 0;
    },
    work: () => ({
      http: rows.length,
      calls: rows.reduce((n, row) => n + row.work.calls, 0),
      statements: rows.reduce((n, row) => n + row.work.statements, 0),
      coverage: rows.filter((row) => row.coverage).length,
    }),
    afterMetadata: (hook: typeof afterMetadata) => {
      afterMetadata = hook;
    },
  };
}

test("seven ready materials avoid coverage hydration in cold, warm and post-mutation workspace reads", async () => {
  const f = await fixture();
  const first = await f.client.get(f.workspaceId);
  // Before this change: 16 HTTP / 138 D1 / 139 SQL, including seven coverage reads.
  expect(f.work()).toEqual({ http: 9, calls: 63, statements: 64, coverage: 0 });
  expect(first.files).toHaveLength(7);
  expect(first.files.every((file) => file.status === "ready" && !!file.name)).toBe(true);
  expect(
    first.files.every((file) => file.coverage === "자료 확인에서 처리 범위를 확인할 수 있어요."),
  ).toBe(true);
  f.reset();
  const warm = await f.client.get(f.workspaceId);
  expect(warm.files).toEqual(first.files);
  // Before: 11 HTTP / 93 D1 / 93 SQL; the existing summary/history cache is unchanged.
  expect(f.work()).toEqual({ http: 4, calls: 23, statements: 23, coverage: 0 });
  f.reset();
  const saved = await f.client.saveTimeline(f.workspaceId, {
    date: "2026-10-14",
    datePrecision: "day",
    title: "합성 일정",
    detail: "합성 저장 뒤 조회",
  });
  expect(saved.timeline).toContainEqual(
    expect.objectContaining({ title: "합성 일정", detail: "합성 저장 뒤 조회" }),
  );
  expect(saved.files).toEqual(first.files);
  // Before #317: 10 HTTP / 78 D1 / 86 SQL. Only the changed timeline is reread;
  // file metadata and both workspace revision fences remain.
  expect(f.work()).toEqual({ http: 6, calls: 42, statements: 49, coverage: 0 });

  f.reset();
  const reportMaterials = await createFilesApi(f.transport).list(f.workspaceId);
  expect(reportMaterials.map((file) => file.id)).toEqual(first.files.map((file) => file.id));
  expect(reportMaterials.every((file) => file.coverage === "문서 1쪽 중 1쪽 확인 가능")).toBe(true);
  expect(f.work()).toEqual({ http: 8, calls: 77, statements: 77, coverage: 7 });
  const review = await createFilesApi(f.transport).review(f.workspaceId, f.selectedFileId);
  expect(review.coverage).toMatchObject({ category: "document", pageCount: 1 });
});

test("workspace metadata is discarded and freshly read after a late file deletion changes workspace revision", async () => {
  const f = await fixture(),
    first = await f.client.get(f.workspaceId);
  let changed = false;
  f.reset();
  f.afterMetadata(() => {
    if (changed) return;
    changed = true;
    f.db.sqlite
      .query("INSERT INTO v2_tombstones VALUES('file',?,?)")
      .run(f.selectedFileId, f.actor.now);
    f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
  });
  const current = await f.client.get(f.workspaceId);
  expect(changed).toBe(true);
  expect(current.case.revision).toBe(first.case.revision + 1);
  expect(current.files).toHaveLength(6);
  expect(current.files.some((file) => file.id === f.selectedFileId)).toBe(false);
  expect(f.rows.filter((row) => row.metadata)).toHaveLength(2);
  expect(f.work().coverage).toBe(0);
});

for (const change of ["role", "session", "owner", "workspace_delete", "account_delete"] as const)
  test(`metadata-only workspace rechecks ${change} at the final boundary and allows its lawyer owner`, async () => {
    const f = await fixture(),
      other = await seedTestSession(f.db, { consent: true });
    await f.client.get(f.workspaceId);
    let changed = false;
    f.reset();
    f.afterMetadata(async () => {
      if (changed) return;
      changed = true;
      if (change === "role") await saveAccountType(f.db.binding, f.actor.ownerId, "lawyer");
      else if (change === "session")
        f.db.sqlite.query("UPDATE session SET expires_at=0 WHERE user_id=?").run(f.actor.ownerId);
      else if (change === "owner")
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(other.userId, f.workspaceId);
      else
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES(?,?,?)")
          .run(
            change === "workspace_delete" ? "workspace" : "account",
            change === "workspace_delete" ? f.workspaceId : f.actor.ownerId,
            f.actor.now,
          );
    });
    if (change === "role") expect((await f.client.get(f.workspaceId)).case.id).toBe(f.workspaceId);
    else
      await expect(f.client.get(f.workspaceId)).rejects.toMatchObject({
        code: change === "session" ? "UNAUTHENTICATED" : "NOT_FOUND",
      });
    expect(changed).toBe(true);
    expect(f.rows.filter((row) => row.metadata)).toHaveLength(1);
    expect(f.work().coverage).toBe(0);
  });
