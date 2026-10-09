import { expect, test } from "bun:test";
import type { V2FileObservation } from "../src/contracts/v2";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createFileReviewService } from "../src/server/modules/files/review";
import { readyFile, reportFixture } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

async function observations(
  f: Awaited<ReturnType<typeof reportFixture>>,
  fileId: string,
  count = 9,
) {
  const source = f.db.sqlite
    .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
    .get(fileId) as { revision: number; coverage_snapshot_id: string };
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID(),
      entityId = crypto.randomUUID();
    ids.push(entityId);
    const value: V2FileObservation = {
      id: entityId,
      text: `원본 추출 ${i} · 010-1234-5678`,
      position: { kind: "document", page: 1, paragraph: i + 1, table: null },
      certainty: "observed",
      userEdited: false,
      included: true,
    };
    const payload = await f.core.encrypt(
      "v2_file_observations",
      id,
      f.actor.ownerId,
      source.revision,
      value,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        entityId,
        fileId,
        source.revision,
        source.revision,
        i,
        payload,
        source.coverage_snapshot_id,
      );
  }
  return ids;
}
test("bounded material correction preserves original, pages, coverage and survives reconnect/lost response", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 원본 바이트"),
    fileId = u.session.fileId,
    ids = await observations(f, fileId);
  const service = () => createFileReviewService(f.core, () => f.actor.now),
    a = f.actor.ownerId;
  const before = await service().read(a, f.workspaceId, fileId);
  expect(before.observations).toHaveLength(4);
  expect(before.nextAfterOrdinal).toBe(3);
  expect(before.coverage).toMatchObject({ category: "document", pageCount: 1 });
  const input = {
      expectedRevision: before.file.revision,
      edits: [
        { observationId: ids[0], text: "사용자 교정한 금액은 300만원", included: true },
        { observationId: ids[1], text: "원본 추출 1 · 010-1234-5678", included: false },
      ],
    },
    key = crypto.randomUUID();
  let saved = await service().start(a, f.workspaceId, fileId, before.workspaceRevision, key, input);
  expect(saved.status).toBe("saving");
  const resume = await service().read(a, f.workspaceId, fileId);
  expect(resume.pendingReview?.reviewId).toBe(saved.reviewId);
  expect(resume.observations[0]?.value.text).toContain("원본 추출");
  while (saved.status !== "ready")
    saved = await service().advance(a, f.workspaceId, fileId, saved.reviewId);
  expect(
    await service().start(a, f.workspaceId, fileId, before.workspaceRevision, key, input),
  ).toEqual(saved);
  const reopened = await service().read(a, f.workspaceId, fileId);
  expect(reopened.pendingReview).toBeNull();
  expect(reopened.file.revision).toBe(before.file.revision + 1);
  expect(reopened.observations[0]).toMatchObject({
    value: {
      text: "사용자 교정한 금액은 300만원",
      userEdited: true,
      certainty: "uncertain",
      position: { page: 1, paragraph: 1 },
    },
    original: { text: "원본 추출 0 · 010-1234-5678", userEdited: false },
  });
  expect(reopened.observations[1]?.value.included).toBe(false);
  expect((await service().read(a, f.workspaceId, fileId, 7)).observations).toHaveLength(1);
  const report = await f.reports.get(a, f.workspaceId);
  expect(report.content).toContain("사용자 교정한 금액은 300만원");
  expect(report.content).toContain("1쪽 · 1번째 문단");
  expect(report.content).not.toContain("원본 추출 1 ·");
  expect(report.content).not.toContain("원본 추출 0 ·");
  const masked = await f.reports.save(a, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: report.content,
    excludedFileIds: [],
    maskIdentifiers: true,
  });
  const pdf = await f.reports.pdf(a, masked.id);
  const bytes = await new Response(pdf.body).arrayBuffer();
  expect(bytes.byteLength).toBe(pdf.byteLength);
  const zip = await f.reports.zip(a, masked.id, crypto.randomUUID(), [fileId]);
  const zipBytes = await new Response(zip.body).arrayBuffer();
  expect(zipBytes.byteLength).toBe(zip.byteLength);
  if (Bun.env.BARO_MATERIAL_EVIDENCE_DIR) {
    await Bun.write(`${Bun.env.BARO_MATERIAL_EVIDENCE_DIR}/corrected-korean-report.pdf`, bytes);
    await Bun.write(`${Bun.env.BARO_MATERIAL_EVIDENCE_DIR}/selected-original.zip`, zipBytes);
  }
});
test("review HTTP isolates owners/workspaces and preserves read/download/delete before re-consent", async () => {
  const f = await reportHttpFixture(),
    ids = await observations(f, f.selectedFileId),
    base = `/api/v2/cases/${f.workspaceId}/files/${f.selectedFileId}`;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    f.app.request(
      path,
      {
        method,
        headers: {
          cookie: f.cookie,
          origin: f.env.BETTER_AUTH_URL,
          "content-type": "application/json",
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      f.env,
    );
  const detail = await call(`${base}/review`);
  expect(detail.status).toBe(200);
  expect(detail.headers.get("cache-control")).toBe("private, no-store");
  const before = (await detail.json()) as Awaited<
    ReturnType<ReturnType<typeof createFileReviewService>["read"]>
  >;
  const patch = {
    expectedRevision: before.file.revision,
    edits: [{ observationId: ids[0], text: "HTTP 교정", included: true }],
  };
  const peer = await seedTestSession(f.db, { consent: true });
  expect((await call(`${base}/review`, "GET", undefined, { cookie: peer.cookie })).status).toBe(
    404,
  );
  expect((await call(`${base.replace(f.workspaceId, crypto.randomUUID())}/review`)).status).toBe(
    404,
  );
  const start = await call(`${base}/observations`, "PATCH", patch, {
    "if-match": String(before.workspaceRevision),
    "idempotency-key": crypto.randomUUID(),
  });
  expect(start.status).toBe(202);
  const pending = (await start.json()) as { reviewId: string };
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  expect((await call(`${base}/review`)).status).toBe(200);
  const original = await call(`${base}/content`);
  expect(original.status).toBe(200);
  expect(await original.text()).toBe(f.original);
  expect((await call(`${base}/observations/${pending.reviewId}/continue`, "POST")).status).toBe(
    403,
  );
  expect(
    (
      await call(`${base}/observations`, "PATCH", patch, {
        "if-match": String(before.workspaceRevision),
        "idempotency-key": crypto.randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect((await call(`${base}/observations/${pending.reviewId}`, "DELETE")).status).toBe(200);
  expect(
    (await call(base, "DELETE", { expectedRevision: f.rev(), fileRevision: before.file.revision }))
      .status,
  ).toBe(202);
  expect((await call(`${base}/review`)).status).toBe(404);
});
test("changed workspace rejects pending publish; discarding and file deletion remove corrections and all report snapshots", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 자료 삭제 검증"),
    fileId = u.session.fileId,
    ids = await observations(f, fileId),
    a = f.actor.ownerId,
    service = createFileReviewService(f.core, () => f.actor.now);
  const start = () =>
    service.start(a, f.workspaceId, fileId, f.rev(), crypto.randomUUID(), {
      expectedRevision: 2,
      edits: [{ observationId: ids[0], text: "늦은 교정", included: true }],
    });
  const pending = await start();
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
  await expect(service.advance(a, f.workspaceId, fileId, pending.reviewId)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect((await service.read(a, f.workspaceId, fileId)).pendingReview?.status).toBe("conflict");
  await service.cancel(a, f.workspaceId, fileId, pending.reviewId);
  const next = await start();
  let saved = next;
  while (saved.status !== "ready")
    saved = await service.advance(a, f.workspaceId, fileId, saved.reviewId);
  const report = await f.reports.get(a, f.workspaceId),
    pdf = await f.reports.pdf(a, report.id);
  await new Response(pdf.body).arrayBuffer();
  expect(
    await createV2DeletionRepository(f.core).file(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      fileId,
      3,
    ),
  ).toBe(true);
  for (const table of [
    "v2_file_observations",
    "v2_file_derivatives",
    "v2_file_edit_stages",
    "v2_file_edit_receipts",
    "v2_reports",
    "v2_report_selections",
  ])
    expect(f.db.sqlite.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM v2_private_snapshots WHERE target_id IN (?,?)")
      .get(fileId, report.id),
  ).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE state='stored'").get()).toEqual({
    n: 0,
  });
  await expect(service.advance(a, f.workspaceId, fileId, next.reviewId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(f.reports.pdf(a, report.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("consent revoked during correction encryption fences publication atomically", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 consent race"),
    fileId = u.session.fileId,
    ids = await observations(f, fileId, 1);
  let revoked = false;
  const core = {
    ...f.core,
    encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
      const value = await f.core.encrypt(...args);
      if (!revoked) {
        revoked = true;
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
      }
      return value;
    },
  };
  await expect(
    createFileReviewService(core, () => f.actor.now).start(
      f.actor.ownerId,
      f.workspaceId,
      fileId,
      f.rev(),
      crypto.randomUUID(),
      {
        expectedRevision: 2,
        edits: [{ observationId: ids[0], text: "저장되면 안 되는 교정", included: true }],
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.db.sqlite.query("SELECT revision FROM v2_files WHERE id=?").get(fileId)).toEqual({
    revision: 2,
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_file_edit_stages").get()).toEqual({ n: 0 });
});

test("retained account deletion journal replay removes restored corrections, pending copies and historical reports twice", async () => {
  const { replayDeletionJournal } = await import("../src/server/modules/deletion/service");
  const f = await reportFixture(),
    u = await readyFile(f, "복구 전에 저장했던 합성 자료"),
    fileId = u.session.fileId,
    ids = await observations(f, fileId),
    a = f.actor.ownerId;
  const service = createFileReviewService(f.core, () => f.actor.now);
  let saved = await service.start(a, f.workspaceId, fileId, f.rev(), crypto.randomUUID(), {
    expectedRevision: 2,
    edits: [{ observationId: ids[0], text: "복구된 교정", included: true }],
  });
  while (saved.status !== "ready")
    saved = await service.advance(a, f.workspaceId, fileId, saved.reviewId);
  const report = await f.reports.get(a, f.workspaceId),
    pdf = await f.reports.pdf(a, report.id);
  await new Response(pdf.body).arrayBuffer();
  const pending = await service.start(a, f.workspaceId, fileId, f.rev(), crypto.randomUUID(), {
    expectedRevision: 3,
    edits: [{ observationId: ids[0], text: "복구된 미완료 교정", included: true }],
  });
  const retained = [
    {
      id: crypto.randomUUID(),
      target_type: "account",
      target_id: a,
      deleted_at: f.actor.now,
      workflow_instance_ids: [],
      expires_at: new Date(Date.parse(f.actor.now) + 35 * 86400000).toISOString(),
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await replayDeletionJournal(f.core.binding, retained)).toEqual({ replayed: 1 });
    for (const table of [
      "user",
      "session",
      "v2_workspaces",
      "v2_files",
      "v2_file_observations",
      "v2_file_edit_stages",
      "v2_file_edit_receipts",
      "v2_reports",
      "v2_private_snapshots",
      "v2_private_parts",
    ])
      expect(f.db.sqlite.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs WHERE state='stored'").get()).toEqual(
      { n: 0 },
    );
    await expect(service.advance(a, f.workspaceId, fileId, pending.reviewId)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  }
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_deletion_journals WHERE state='pending'").get(),
  ).not.toEqual({ n: 0 });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
