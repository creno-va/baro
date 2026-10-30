import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createReportHtml } from "../src/components/reports/document";
import type { V2Fact } from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createReportsApi } from "../src/server/api/v2/reports";
import { createV2Core, snapshotStatements } from "../src/server/db/v2-core";
import { renderReportPdf } from "../src/server/modules/reports/pdf";
import { createReportDependencies } from "../src/server/modules/reports/runtime";
import { createReportsService } from "../src/server/modules/reports/service";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { fixture, uploaded } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";
import { seedTestSession } from "./helpers/session";

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

test("inline photo HTTP is private and owner-bound; deletion and a file change during read revoke access", async () => {
  const f = await photoFixture();
  const draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
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
  const app = new Hono<ApiEnvironment>().route(
    "/api/v2",
    createReportsApi({
      testOnlyMissingD1Meta: true,
      dependencies: async () => ({ ...f.deps, files: f.service }),
    }),
  );
  const path = `/api/v2/reports/${draft.id}/photos/${f.id}`;
  const get = (auth = cookie) => app.request(path, { headers: { cookie: auth } }, env);
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array(await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer()),
  );
  const peer = await seedTestSession(f.db, { consent: true });
  expect((await get(peer.cookie)).status).toBe(404);
  expect((await get("")).status).toBe(401);
  const service = createReportsService(f.core, {
    ...f.deps,
    files: {
      ...f.service,
      content: async (...args) => {
        const result = await f.service.content(...args);
        f.db.sqlite.query("DELETE FROM v2_files WHERE id=?").run(f.id);
        return result;
      },
    },
  });
  await expect(service.photo(f.actor.ownerId, draft.id, f.id)).rejects.toThrow();
  expect((await get()).status).not.toBe(200);
});

test("inline photo markers save exact position; forged selections and repeated image amplification fail", async () => {
  const f = await photoFixture();
  const draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const token = `![합성 본문 사진](baro-photo:${f.id})`;
  const content = `사건 개요\n사진 앞\n\n${token}\n\n사진 뒤\n\n추가 확인 사항\n- 거래 일시 확인`;
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content,
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  expect(saved.includedPhotoIds).toEqual([f.id]);
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(content);
  const html = await f.reports.html(f.actor.ownerId, saved.id);
  expect(html.indexOf("사진 앞")).toBeLessThan(html.indexOf("<figure"));
  expect(html.indexOf("</figure>")).toBeLessThan(html.indexOf("사진 뒤"));
  for (const input of [
    { content, includedPhotoIds: [] },
    { content: `사건 개요\n${Array(13).fill(token).join("\n")}` },
    { content: "사건 개요\n![외부 자료](baro-photo:foreign-photo)" },
  ])
    await expect(
      f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: saved.revision,
        maskIdentifiers: false,
        excludedFileIds: [],
        ...input,
      }),
    ).rejects.toThrow();
});

test("report body retains correction attribution while captions contain only the chosen filename", async () => {
  const f = await photoFixture();
  const reference = {
    kind: "user_material" as const,
    fileId: f.id,
    fileRevision: 2,
    position: { kind: "image" as const, region: null },
  };
  for (const attribution of ["user_material", "ai_organization"] as const) {
    const id = crypto.randomUUID();
    const fact: V2Fact = {
      id,
      text:
        attribution === "user_material" ? "직접 고친 합성 사진 설명" : "원문이 아닌 합성 AI 정리",
      attribution,
      certainty: "uncertain",
      significance: "neutral",
      references: [reference],
      conflictingFactIds: [],
      userEdited: attribution === "user_material",
    };
    f.db.sqlite
      .query(
        "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES(?,?,?,1,?)",
      )
      .run(id, id, f.workspaceId, await f.core.encrypt("v2_facts", id, f.actor.ownerId, 1, fact));
  }
  const draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: draft.content,
    maskIdentifiers: false,
    excludedFileIds: [],
    includedPhotoIds: [f.id],
  });
  const html = await f.reports.html(f.actor.ownerId, saved.id);
  const caption = html.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] ?? "";
  expect(caption).not.toContain("직접 고친 합성 사진 설명");
  expect(html).toContain("직접 수정 · 직접 고친 합성 사진 설명");
  expect(caption).not.toContain("원문이 아닌 합성 AI 정리");
  expect(html).toContain("원문이 아닌 합성 AI 정리");
  f.db.close();
});

test.each(["removed", "redacted"] as const)(
  "photo captions never restore %s text from a saved review in HTML or PDF input",
  async (edit) => {
    const f = await photoFixture();
    try {
      const id = crypto.randomUUID();
      const marker = "SYNTHETIC_PRIVATE_NAME_567";
      const fact: V2Fact = {
        id,
        text: `공유에서 가릴 합성 이름 ${marker}`,
        attribution: "user_material",
        certainty: "uncertain",
        significance: "neutral",
        references: [
          {
            kind: "user_material",
            fileId: f.id,
            fileRevision: 2,
            position: { kind: "image", region: null },
          },
        ],
        conflictingFactIds: [],
        userEdited: true,
      };
      f.db.sqlite
        .query(
          "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES(?,?,?,1,?)",
        )
        .run(id, id, f.workspaceId, await f.core.encrypt("v2_facts", id, f.actor.ownerId, 1, fact));
      const draft = await f.reports.get(f.actor.ownerId, f.workspaceId);
      const original = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: draft.revision,
        content: draft.content,
        maskIdentifiers: false,
        excludedFileIds: [],
        includedPhotoIds: [f.id],
      });
      const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: original.revision,
        content:
          edit === "removed"
            ? original.content.replaceAll(fact.text, "")
            : original.content.replaceAll(marker, "[가림]"),
        maskIdentifiers: false,
        excludedFileIds: [],
        includedPhotoIds: [f.id],
      });
      expect(saved.content.includes(marker)).toBe(false);
      const html = await f.reports.html(f.actor.ownerId, saved.id);
      expect(html).toContain("data:image/jpeg;base64,");
      expect(html.includes(marker)).toBe(false);
      await f.reports.pdf(f.actor.ownerId, saved.id);
      expect(f.rendered).toHaveLength(1);
      expect(f.rendered[0]).toContain("data:image/jpeg;base64,");
      expect(f.rendered[0]?.includes(marker)).toBe(false);
      // Editing a new report never mutates its original source facts or older review.
      expect((await f.reports.html(f.actor.ownerId, original.id)).includes(marker)).toBe(true);
    } finally {
      f.db.close();
    }
  },
);

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
  expect(html).toContain(`data-report-photo="${f.id}"`);
  expect(html).not.toContain("자료 처리 범위");
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
  f.db.sqlite.exec(
    "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',100000000)",
  );
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
        prepareCapacity: async () => true,
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
  expect(
    f.db.sqlite
      .query("SELECT service,state,transport FROM v2_execution_admissions ORDER BY service")
      .all(),
  ).toEqual([
    { service: "container", state: "final", transport: "response" },
    { service: "requests", state: "final", transport: "response" },
  ]);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toMatchObject({
    n: 0,
  });
});

test("deletion during the selected original read prevents publishing a photo preview", async () => {
  const f = await photoFixture(),
    owner = f.actor.ownerId,
    draft = await f.reports.get(owner, f.workspaceId);
  const saved = await f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: draft.content,
    maskIdentifiers: false,
    excludedFileIds: [],
    includedPhotoIds: [f.id],
  });
  let opened = 0;
  const service = createReportsService(f.core, {
    ...f.deps,
    files: {
      ...f.service,
      content: async (...args) => {
        const source = await f.service.content(...args);
        opened++;
        f.db.sqlite.query("DELETE FROM v2_files WHERE id=?").run(f.id);
        return source;
      },
    },
  });
  await expect(service.html(owner, saved.id)).rejects.toThrow();
  expect(opened).toBe(1);
});

test("historical photo preview keeps its immutable basis after an unrelated source update, while new PDF generation stays fenced", async () => {
  const f = await photoFixture(),
    owner = f.actor.ownerId,
    draft = await f.reports.get(owner, f.workspaceId);
  const saved = await f.reports.save(owner, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: draft.revision,
    content: draft.content,
    maskIdentifiers: false,
    excludedFileIds: [],
    includedPhotoIds: [f.id],
  });
  f.db.sqlite
    .query("UPDATE v2_workspaces SET confirmed_summary_revision=2,revision=revision+1 WHERE id=?")
    .run(f.workspaceId);
  const html = await f.reports.html(owner, saved.id);
  expect(html).not.toContain("이전 생성 기준");
  expect(html).toContain("data:image/jpeg;base64,");
  await expect(f.reports.pdf(owner, saved.id)).rejects.toThrow("STALE_REVISION");
});
