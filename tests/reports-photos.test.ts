import { expect, test } from "bun:test";
import { createReportHtml } from "../src/components/reports/document";
import { createV2Core, snapshotStatements } from "../src/server/db/v2-core";
import { renderReportPdf } from "../src/server/modules/reports/pdf";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { createReportsService } from "../src/server/modules/reports/service";
import { fixture, uploaded } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";

async function photoFixture() {
  const base = await fixture({
    probe: async (input) => {
      await new Response(input.open()).arrayBuffer();
      return {
        category: "image",
        format: "jpeg",
        byteLength: input.byteLength,
        width: 640,
        height: 480,
      };
    },
  });
  const f = await reportFixture(base);
  const bytes = new Uint8Array(
    await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer(),
  );
  const file = await uploaded(base, bytes),
    id = file.session.fileId,
    coverage = crypto.randomUUID(),
    claim = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: coverage,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: id,
        revision: 2,
        purpose: "file_coverage",
        now: f.actor.now,
      },
      { category: "image", status: "complete", observation: "processed" },
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "UPDATE v2_files SET state='ready',coverage_snapshot_id=?,operation_id=(SELECT operation_id FROM v2_upload_sessions WHERE file_id=?) WHERE id=?",
    )
    .run(coverage, id, id);
  const rowId = crypto.randomUUID(),
    observationId = crypto.randomUUID();
  const payload = await f.core.encrypt("v2_file_observations", rowId, f.actor.ownerId, 2, {
    id: observationId,
    text: "[보이는 상태] 합성 표식이 보임. [확인 필요] 촬영 날짜와 사건과의 관계를 알려 주세요.",
    position: { kind: "image", region: null },
    certainty: "uncertain",
    userEdited: false,
    included: true,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,0,?)",
    )
    .run(rowId, observationId, id, payload);
  const rendered: string[] = [];
  let reads = 0;
  const reports = createReportsService(f.core, {
    ...f.deps,
    files: {
      ...f.service,
      content: async (...args) => {
        reads++;
        return f.service.content(...args);
      },
    },
    renderPdf: async (html) => {
      rendered.push(html);
      return renderReportPdf(await f.deps.font(), {
        title: "명시적 오프라인 PDF 대역",
        content: "HTML 내용은 별도 native fixture에서 렌더링 검증합니다.",
        revision: 1,
        updatedAt: f.actor.now,
        maskIdentifiers: false,
        excludedFileCount: 0,
      });
    },
  });
  return { ...f, reports, id, rendered, reads: () => reads };
}

test("owned photo observations reach case report text; explicit selection reaches both HTML and PDF input with revision provenance", async () => {
  const f = await photoFixture(),
    owner = f.actor.ownerId;
  const draft = await f.reports.get(owner, f.workspaceId);
  expect(draft.content).toContain("촬영 날짜와 사건과의 관계");
  expect(draft.photoCandidates?.map((photo) => photo.id)).toEqual([f.id]);
  expect(draft.includedPhotoIds).toEqual([]);
  expect(await f.reports.html(owner, draft.id)).not.toContain("data:image/jpeg");
  const saved = await f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: draft.content,
    maskIdentifiers: false,
    excludedFileIds: [],
    includedPhotoIds: [f.id],
  });
  const html = await f.reports.html(owner, saved.id);
  expect(html).toContain("data:image/jpeg;base64,");
  expect(html).toContain("자료 버전 2");
  expect(html).toContain("의학적 판단");
  await f.reports.pdf(owner, saved.id);
  expect(f.rendered).toHaveLength(1);
  expect(f.rendered[0]).toContain("data:image/jpeg;base64,");
  expect(f.rendered[0]).toContain("data:font/ttf;base64,");
  expect(f.rendered[0]).toContain("촬영 날짜와 사건과의 관계");
  for (const value of f.bucket.objects.values())
    expect(new TextDecoder().decode(value)).not.toContain("촬영 날짜와 사건과의 관계");
});

test("identifier masking excludes image pixels entirely, preserves the choice, and performs no photo reads", async () => {
  const f = await photoFixture(),
    owner = f.actor.ownerId,
    draft = await f.reports.get(owner, f.workspaceId);
  const saved = await f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: draft.content,
    maskIdentifiers: true,
    excludedFileIds: [],
    includedPhotoIds: [f.id],
  });
  expect(saved.includedPhotoIds).toEqual([f.id]);
  expect(await f.reports.html(owner, saved.id)).not.toContain("data:image/jpeg");
  await f.reports.pdf(owner, saved.id);
  expect(f.rendered[0]).not.toContain("data:image/jpeg");
  expect(f.reads()).toBe(0);
});

test("foreign, duplicate, excluded and stale photo choices fail before export; deletion revokes already-open sources", async () => {
  const f = await photoFixture(),
    owner = f.actor.ownerId,
    draft = await f.reports.get(owner, f.workspaceId);
  const save = (ids: string[], excludedFileIds: string[] = []) =>
    f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: draft.revision,
      content: draft.content,
      maskIdentifiers: false,
      excludedFileIds,
      includedPhotoIds: ids,
    });
  await expect(save([crypto.randomUUID()])).rejects.toThrow("VALIDATION_ERROR");
  await expect(save([f.id, f.id])).rejects.toThrow();
  await expect(save([f.id], [f.id])).rejects.toThrow("VALIDATION_ERROR");
  const saved = await save([f.id]);
  await expect(f.reports.html(crypto.randomUUID(), saved.id)).rejects.toThrow("NOT_FOUND");
  f.db.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(f.id);
  await expect(f.reports.pdf(owner, saved.id)).rejects.toThrow("STALE_REVISION");
});

test("report template escapes captions, rejects remote/SVG photo URLs and excludes selected photos under masking", () => {
  const photo = {
    id: "photo",
    name: '<img src=x onerror="bad">',
    revision: 2,
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
  };
  const document = {
    title: "합성",
    content: "사건 요약\n내용",
    revision: 1,
    updatedAt: "2026-10-21T00:00:00Z",
    stale: false,
    maskIdentifiers: false,
    excludedFileIds: [],
    photos: [photo],
  };
  expect(createReportHtml(document)).toContain("&lt;img");
  expect(
    createReportHtml({
      ...document,
      photos: [{ ...photo, dataUrl: "https://private.invalid/photo" }],
    }),
  ).not.toContain("https://private.invalid");
  expect(
    createReportHtml({
      ...document,
      photos: [{ ...photo, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }],
    }),
  ).not.toContain("PHN2Zz4=");
  expect(createReportHtml({ ...document, maskIdentifiers: true })).not.toContain("/9j/2Q==");
  expect(createReportHtml({ ...document, excludedFileIds: ["photo"] })).not.toContain("/9j/2Q==");
});

test("real report renderer composition admits bounded native work with missing cost observations and records response without inventing usage", async () => {
  const f = await reportFixture();
  const core = createV2Core(f.db.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  const requests: string[] = [],
    names: string[] = [];
  let stopped = 0;
  const bytes = await renderReportPdf(await f.deps.font(), {
    title: "합성 native 응답 대역",
    content: "컨테이너의 조판 자체는 별도 Linux fixture로 검증합니다.",
    revision: 1,
    updatedAt: f.actor.now,
    maskIdentifiers: false,
    excludedFileCount: 0,
  });
  const env = {
    APP_ENV: "preview",
    CASE_PRIVATE_R2: f.bucketPort,
    ASSETS: { fetch: async () => new Response(await f.deps.font()) },
    FILE_PROCESSOR: {
      idFromName: (name: string) => {
        names.push(name);
        return name;
      },
      get: () => ({
        fetch: async (request: Request) => {
          expect(new URL(request.url).pathname).toBe("/report");
          requests.push(await request.text());
          return new Response(bytes.slice(), { headers: { "content-type": "application/pdf" } });
        },
        stopProcessing: async () => {
          stopped++;
        },
      }),
    },
  } as unknown as Env;
  const runtime = createReportDependencies(env, core, f.actor.ownerId, () => f.actor.now);
  const service = createReportsService(core, {
    ...runtime,
    files: f.service,
    testOnlyUnmeteredStorage: true,
    fixedLength: f.deps.fixedLength,
  });
  const report = await service.get(f.actor.ownerId, f.workspaceId);
  const output = await service.pdf(f.actor.ownerId, report.id);
  expect(new Uint8Array(await new Response(output.body).arrayBuffer())).toEqual(bytes);
  expect(names[0]).toMatch(/^native-v1-report-[a-f0-9-]{36}-1$/);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('data-baro-report="1"');
  expect(stopped).toBe(1);
  const admission = f.db.sqlite
    .query(
      "SELECT a.state,a.transport,p.payload_json FROM v2_execution_admissions a JOIN v2_execution_job_plans p ON p.id=a.plan_id WHERE json_extract(p.payload_json,'$.service')='container'",
    )
    .get();
  expect(admission).toMatchObject({ state: "final", transport: "response" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toMatchObject({
    n: 0,
  });
});
