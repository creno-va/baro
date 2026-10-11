import { expect } from "bun:test";
import { snapshotStatements } from "../../src/server/db/v2-core";
import { createV2FilesRepository } from "../../src/server/db/v2-files";
import type { PrivateBucket } from "../../src/server/modules/files/service";
import { createReportsService } from "../../src/server/modules/reports/service";
import { fixture, uploaded } from "./file-processing-fixture";

export async function reportFixture(
  base?: Pick<
    Awaited<ReturnType<typeof fixture>>,
    "db" | "core" | "actor" | "workspaceId" | "bucket" | "service" | "rev"
  >,
) {
  const f = base ?? (await fixture());
  const id = crypto.randomUUID(),
    snapshotId = crypto.randomUUID(),
    claim = crypto.randomUUID();
  const summary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 1,
    createdAt: f.actor.now,
    overview: "합성 리포트 사건 요약 · 전화 010-1234-5678",
    facts: [],
    parties: [],
    unknowns: ["상대방의 입장은 미확인"],
    notices: ["합성 검증 자료"],
  };
  const g = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() };
  await f.core.binding.batch([
    f.core.claim(g, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: snapshotId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: f.workspaceId,
        revision: 1,
        purpose: "summary",
        now: f.actor.now,
      },
      summary,
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) VALUES(?,?,1,1,?,?)",
    )
    .run(id, f.workspaceId, snapshotId, f.actor.now);
  const envelope = await f.core.encrypt("v2_intakes", f.workspaceId, f.actor.ownerId, 1, {
    narrative: "합성 검증용 사건 서술이며 자료와 사실을 정리합니다.",
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_intakes(id,status,summary_id,confirmed_summary_revision,encrypted_payload,updated_at) VALUES(?,'confirmed',?,1,?,?)",
    )
    .run(f.workspaceId, id, envelope, f.actor.now);
  let hook: (() => Promise<void>) | undefined;
  let fail = false;
  const bucket = {
    ...f.bucket.port,
    put: async (key: string, value: ReadableStream<Uint8Array>) => {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      f.bucket.objects.set(key, bytes);
      await hook?.();
      if (fail) throw new Error("synthetic ambiguous write");
      return { key, size: bytes.length };
    },
  } as unknown as PrivateBucket;
  const deps = {
    environment: "preview" as const,
    bucket,
    files: f.service,
    clock: () => f.actor.now,
    testOnlyUnmeteredStorage: true as const,
    font: async () =>
      new Uint8Array(await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer()),
    fixedLength: (body: ReadableStream<Uint8Array>) => ({ body, done: Promise.resolve() }),
  };
  return {
    ...f,
    bucketPort: bucket,
    deps,
    reports: createReportsService(f.core, deps),
    setHook: (value: typeof hook) => {
      hook = value;
    },
    setFailure: (value: boolean) => {
      fail = value;
    },
  };
}
export async function readyFile(f: Awaited<ReturnType<typeof reportFixture>>, text: string) {
  const u = await uploaded(f, new TextEncoder().encode(text));
  const fileId = u.session.fileId,
    coverageId = crypto.randomUUID(),
    claim = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: coverageId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: fileId,
        revision: 2,
        purpose: "file_coverage",
        now: f.actor.now,
      },
      {
        category: "document",
        status: "complete",
        pageCount: 1,
        pages: [{ page: 1, status: "processed" }],
      },
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "UPDATE v2_files SET state='ready',coverage_snapshot_id=?,operation_id=(SELECT operation_id FROM v2_upload_sessions WHERE file_id=?) WHERE id=?",
    )
    .run(coverageId, fileId, fileId);
  expect((await createV2FilesRepository(f.core).read(f.actor, fileId))?.status).toBe("ready");
  return u;
}
