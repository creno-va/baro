import { expect, test } from "bun:test";
import type { V2ReportBody, V2TimelineEntry } from "../src/contracts/v2";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { zipNames } from "../src/server/modules/reports/zip";
import { readyFile, reportFixture } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";

async function summary(
  f: Awaited<ReturnType<typeof reportFixture>>,
  facts: V2ReportBody["facts"],
  overview: string,
) {
  const snapshotId = crypto.randomUUID(),
    claim = crypto.randomUUID(),
    id = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: snapshotId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: f.workspaceId,
        revision: 2,
        purpose: "summary",
        now: f.actor.now,
      },
      {
        schemaVersion: "2",
        revision: 2,
        intakeRevision: 1,
        createdAt: f.actor.now,
        overview,
        facts,
        parties: [],
        unknowns: [],
        notices: ["합성 검증 자료"],
      },
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "INSERT INTO v2_summaries(id,workspace_id,revision,intake_revision,snapshot_id,created_at) VALUES(?,?,2,1,?,?)",
    )
    .run(id, f.workspaceId, snapshotId, f.actor.now);
  f.db.sqlite
    .query(
      "UPDATE v2_intakes SET summary_id=?,status='confirmed',confirmed_summary_revision=2 WHERE id=?",
    )
    .run(id, f.workspaceId);
  f.db.sqlite
    .query("UPDATE v2_workspaces SET confirmed_summary_revision=2 WHERE id=?")
    .run(f.workspaceId);
}

test("native PDF preserves generation basis, exclusions and masking metadata", async () => {
  const f = await reportHttpFixture(),
    prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content: prior.content,
    maskIdentifiers: true,
    excludedFileIds: [f.selectedFileId],
  });
  const pdf = await f.app.request(
    `/api/v2/reports/${saved.id}/pdf`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(pdf.status).toBe(200);
  const pdfBytes = await pdf.arrayBuffer();
  const raw = new TextDecoder().decode(pdfBytes);
  const glyphs = new Map(
    [...raw.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g)]
      .filter((m) => m[2] !== "FFFF")
      .map((m) => [
        m[1],
        String.fromCharCode(...((m[2] ?? "").match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))),
      ]),
  );
  const text = [...raw.matchAll(/<([0-9a-f]+)> Tj/g)]
    .map((m) => ((m[1] ?? "").match(/.{4}/g) ?? []).map((cid) => glyphs.get(cid) ?? "").join(""))
    .join("\n");
  expect(text).toContain(
    `생성 기준: 요약 ${saved.basis?.summaryRevision} · 사건 ${saved.basis?.workspaceRevision}`,
  );
  expect(text).toContain("제외 자료: 1개 · 식별정보 자동 가림: 켜짐");
  if (process.env.BARO_REPORT_EVIDENCE)
    await Bun.write(`${process.env.BARO_REPORT_EVIDENCE}/native-report.pdf`, pdfBytes);
  const html = await f.app.request(
    `/api/v2/reports/${saved.id}/html`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(html.status).toBe(200);
  f.db.close();
});

test("compound extensions and superscript Windows devices extract safely", async () => {
  const names = ["NUL.tar.gz", "CON.notes.pdf", "COM¹.txt", "LPT².pdf", "normal.txt"];
  const mapped = zipNames(
    names.map((name) => ({
      id: crypto.randomUUID(),
      name,
      byteLength: 1,
      contentHash: "a".repeat(64),
      open: async () => new ReadableStream(),
    })),
  ).map((b) => new TextDecoder().decode(b));
  expect(mapped).toEqual(["_NUL.tar.gz", "_CON.notes.pdf", "_COM¹.txt", "_LPT².pdf", "normal.txt"]);
});

test("excluded source details do not survive in aggregate summary fields", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "원본에서만 확인한 합성 약정 금액 735만원");
  const text = "원본에서만 확인한 합성 약정 금액은 735만원입니다.";
  const fact: V2ReportBody["facts"][number] = {
    id: crypto.randomUUID(),
    text,
    attribution: "user_material",
    certainty: "observed",
    significance: "neutral",
    references: [
      {
        kind: "user_material",
        fileId: u.session.fileId,
        fileRevision: 2,
        position: { kind: "document", page: 1, paragraph: null, table: null },
      },
    ],
    conflictingFactIds: [],
    userEdited: false,
  };
  await summary(f, [fact], text);
  const prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content: prior.content,
    maskIdentifiers: false,
    excludedFileIds: [u.session.fileId],
  });
  const canonical = await createV2ReportsRepository(f.core).read(f.actor, saved.id);
  expect(canonical?.body.facts).toHaveLength(0);
  expect(canonical?.body.selectedFiles).toHaveLength(0);
  expect(saved.content).not.toContain(text);
  expect(saved.content).toContain("자료를 제외한 리포트");
  f.db.close();
});

test("conflicting facts use human-readable labels", async () => {
  const f = await reportFixture(),
    ids = [crypto.randomUUID(), crypto.randomUUID()] as const;
  const facts: V2ReportBody["facts"] = ids.map((id, i) => ({
    id,
    text: i ? "합성 진술: 변제받지 못했습니다." : "합성 진술: 전액 변제받았습니다.",
    attribution: "user_statement",
    certainty: "conflicting",
    significance: "neutral",
    references: [{ kind: "intake_narrative", intakeRevision: 1 }],
    conflictingFactIds: [ids[i === 0 ? 1 : 0]],
    userEdited: false,
  }));
  await summary(f, facts, "합성 상반 진술");
  const r = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(r.content).toContain("상반 항목: 사실 1");
  expect(r.content).not.toContain(ids[0] ?? "missing");
  expect(r.content).toContain("상반 항목: 사실 2");
  expect(r.content).toContain("사실 1 · 합성 진술");
  f.db.close();
});

test("exclusions preserve independent conflicting statements with uncertainty", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 자료: 지급 기록 300만원");
  const ids = [crypto.randomUUID(), crypto.randomUUID()] as const;
  const retainedText = "사용자 진술: 지급받은 금액은 0원입니다.";
  const facts: V2ReportBody["facts"] = [
    {
      id: ids[0],
      text: retainedText,
      attribution: "user_statement",
      certainty: "conflicting",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [ids[1]],
      userEdited: false,
    },
    {
      id: ids[1],
      text: "자료 관찰: 지급 기록은 300만원입니다.",
      attribution: "user_material",
      certainty: "conflicting",
      significance: "neutral",
      references: [
        {
          kind: "user_material",
          fileId: u.session.fileId,
          fileRevision: 2,
          position: { kind: "document", page: 1, paragraph: null, table: null },
        },
      ],
      conflictingFactIds: [ids[0]],
      userEdited: false,
    },
  ];
  await summary(f, facts, "독립 진술 보존 합성 검증");
  const prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(prior.content).toContain(retainedText);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content: prior.content,
    maskIdentifiers: false,
    excludedFileIds: [u.session.fileId],
  });
  const body = (await createV2ReportsRepository(f.core).read(f.actor, saved.id))?.body;
  expect(body?.facts).toHaveLength(1);
  expect(body?.facts[0]?.certainty).toBe("uncertain");
  expect(body?.facts[0]?.conflictingFactIds).toEqual([]);
  expect(saved.content).toContain(retainedText);
  expect(saved.content).not.toContain("자료 관찰: 지급 기록은 300만원입니다.");
  f.db.close();
});

import { v2CoverageSchema } from "../src/contracts/v2";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import {
  fixture as fileBaseFixture,
  uploaded as uploadSynthetic,
} from "./helpers/file-processing-fixture";

test("video export shows failed and low-quality sample positions", async () => {
  const base = await fileBaseFixture({
    probe: async (input) => {
      await new Response(input.open()).arrayBuffer();
      return {
        category: "video",
        format: "mp4",
        byteLength: input.byteLength,
        durationSeconds: 3,
        hasAudio: false,
      };
    },
  });
  const f = await reportFixture(base),
    u = await uploadSynthetic(f, new TextEncoder().encode("synthetic video bytes"));
  const coverage = v2CoverageSchema.parse({
    category: "video",
    durationSeconds: 3,
    status: "partial",
    hasAudio: false,
    audio: null,
    frames: [
      {
        id: crypto.randomUUID(),
        timestampSeconds: 0,
        frameIndex: 0,
        sampling: "one_second",
        status: "processed",
      },
      {
        id: crypto.randomUUID(),
        timestampSeconds: 1,
        frameIndex: 30,
        sampling: "one_second",
        status: "failed",
      },
      {
        id: crypto.randomUUID(),
        timestampSeconds: 2,
        frameIndex: 60,
        sampling: "one_second",
        status: "low_quality",
      },
    ],
    sceneDetection: "complete",
    sceneFrameCount: 0,
  });
  const coverageId = crypto.randomUUID(),
    claim = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claim),
    ...(await snapshotStatements(
      f.core,
      {
        id: coverageId,
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        targetId: u.session.fileId,
        revision: 2,
        purpose: "file_coverage",
        now: f.actor.now,
      },
      coverage,
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query(
      "UPDATE v2_files SET state='ready',coverage_snapshot_id=?,operation_id=(SELECT operation_id FROM v2_upload_sessions WHERE file_id=?) WHERE id=?",
    )
    .run(coverageId, u.session.fileId, u.session.fileId);
  const file = await createV2FilesRepository(f.core).read(f.actor, u.session.fileId);
  expect(file?.probe?.category).toBe("video");
  expect(file?.coverage).toEqual(coverage);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(report.content).toContain("1/3개 표본 처리");
  expect(report.content).toContain("1초 · 프레임 30 실패");
  expect(report.content).toContain("2초 · 프레임 60 품질 낮음");
  f.db.close();
});

test("unedited uncertain observations retain their uncertainty label", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "합성 문서 원본"),
    rowId = crypto.randomUUID(),
    entityId = crypto.randomUUID();
  const observation = {
    id: entityId,
    text: "판독이 불명확한 합성 금액 750만원",
    position: { kind: "document", page: 1, paragraph: 2, table: null },
    certainty: "uncertain",
    userEdited: false,
    included: true,
  };
  const encrypted = await f.core.encrypt(
    "v2_file_observations",
    rowId,
    f.actor.ownerId,
    2,
    observation,
  );
  f.db.sqlite
    .query(
      "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,0,?)",
    )
    .run(rowId, entityId, u.session.fileId, encrypted);
  const file = await createV2FilesRepository(f.core).read(f.actor, u.session.fileId);
  expect(file?.observations[0]?.certainty).toBe("uncertain");
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const coverageBlock = report.content.split("자료 처리 범위")[1]?.split("안내")[0] ?? "";
  expect(coverageBlock).toContain(`자료 관찰 · 미확인\n${observation.text}`);
  expect(coverageBlock).toContain("미확인");
  expect(coverageBlock).not.toContain("확인 필요");
  f.db.close();
});

import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";

test("saved HTML preserves trailing headings", async () => {
  const f = await reportHttpFixture(),
    prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const content = "사건 요약\n합성 검토 내용입니다.\n\n준비할 행동";
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content,
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  expect(saved.content).toBe(content);
  const result = await f.app.request(
    `/api/v2/reports/${saved.id}/html`,
    { headers: { cookie: f.cookie } },
    f.env,
  );
  expect(result.status).toBe(200);
  const html = await result.text();
  expect(html).toContain("합성 검토 내용입니다.");
  expect(html).toContain("준비할 행동");
  f.db.close();
});

test("timeline exports in chronological order", async () => {
  const f = await reportFixture(),
    ws = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const entries: V2TimelineEntry[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      date: "2026-02-01",
      datePrecision: "day",
      event: "합성 후속 사건",
      certainty: "reported",
      references: [],
      factIds: [],
      userEdited: false,
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      revision: 1,
      date: "2025-01-01",
      datePrecision: "day",
      event: "합성 선행 사건",
      certainty: "reported",
      references: [],
      factIds: [],
      userEdited: false,
    },
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      revision: 1,
      date: "2027-03-01",
      datePrecision: "day",
      event: "합성 마지막 사건",
      certainty: "reported",
      references: [],
      factIds: [],
      userEdited: false,
    },
  ];
  for (const entry of entries)
    expect(
      await ws.writeTimeline(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        entry,
        null,
      ),
    ).toBe(true);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(report.content.indexOf("2025-01-01")).toBeLessThan(report.content.indexOf("2026-02-01"));
  expect(report.content.indexOf("2026-02-01")).toBeLessThan(report.content.indexOf("2027-03-01"));
  f.db.close();
});

test("initial oversized source recovers with report-only exclusions", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "긴 합성 문서 원본입니다."),
    fileId = u.session.fileId;
  for (let ordinal = 0; ordinal < 5; ordinal++) {
    const rowId = crypto.randomUUID(),
      entityId = crypto.randomUUID();
    const observation = {
      id: entityId,
      text: `합성 관찰 ${ordinal} ${"자료 내용 ".repeat(740)}`,
      position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
      certainty: "observed",
      userEdited: false,
      included: true,
    };
    expect(observation.text.length).toBeLessThanOrEqual(5000);
    const payload = await f.core.encrypt(
      "v2_file_observations",
      rowId,
      f.actor.ownerId,
      2,
      observation,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,?,?)",
      )
      .run(rowId, entityId, fileId, ordinal, payload);
  }
  const validFile = await createV2FilesRepository(f.core).read(f.actor, fileId);
  expect(validFile?.status).toBe("ready");
  expect(validFile?.observations).toHaveLength(5);
  await expect(f.reports.get(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
    code: "EXPORT_LIMIT_EXCEEDED",
  });
  await expect(
    f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {}),
  ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
  await expect(
    f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: 1,
      content: "자료를 제외하고 사건만 검토합니다.",
      excludedFileIds: [fileId],
      maskIdentifiers: false,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  const recovered = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    excludedFileIds: [fileId],
  });
  expect(recovered.excludedFileIds).toEqual([fileId]);
  expect(recovered.content).not.toContain("합성 관찰 0");
  const body = (await createV2ReportsRepository(f.core).read(f.actor, recovered.id))?.body;
  expect(body?.selectedFiles).toHaveLength(0);
  const reportCount = (
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_reports WHERE workspace_id=?")
      .get(f.workspaceId) as { n: number }
  ).n;
  expect(reportCount).toBe(1);
  f.db.close();
});

test("unsaved editing is rejected safely then retained in the previous revision", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "제외할 합성 자료 원본");
  const prior = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const marker = "새로 작성한 독립 상담 질문: 반환기한을 별도로 확인합니다.";
  const submittedContent = `${prior.content}\n\n${marker}`;
  await expect(
    f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: prior.revision,
      content: submittedContent,
      maskIdentifiers: false,
      excludedFileIds: [u.session.fileId],
    }),
  ).rejects.toMatchObject({ code: "EDITS_REQUIRE_SAVE" });
  const edited = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: prior.revision,
    content: submittedContent,
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  expect(edited.content).toContain(marker);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: edited.revision,
    content: edited.content,
    maskIdentifiers: false,
    excludedFileIds: [u.session.fileId],
  });
  expect(saved.excludedFileIds).toEqual([u.session.fileId]);
  expect(await f.reports.html(f.actor.ownerId, edited.id)).toContain(marker);
  f.db.close();
});

test("exhausted PDF retry stops and recovers without dropping review content", async () => {
  const f = await reportFixture(),
    report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  f.setFailure(true);
  for (let attempt = 0; attempt < 3; attempt++)
    await expect(f.reports.pdf(f.actor.ownerId, report.id)).rejects.toMatchObject({
      code: attempt < 2 ? "STORAGE_UNAVAILABLE" : "EXPORT_RETRY_EXHAUSTED",
    });
  f.setFailure(false);
  const writesBeforeRecovery = f.bucket.objects.size;
  await expect(f.reports.pdf(f.actor.ownerId, report.id)).rejects.toMatchObject({
    code: "EXPORT_RETRY_EXHAUSTED",
  });
  const job = f.db.sqlite
    .query(
      "SELECT j.attempts,j.status,j.retryable FROM v2_jobs j JOIN v2_reports r ON r.current_job_id=j.id WHERE r.id=?",
    )
    .get(report.id) as { attempts: number; status: string; retryable: number };
  expect(job.attempts).toBe(3);
  expect(job.retryable).toBe(0);
  expect(f.bucket.objects.size).toBe(writesBeforeRecovery);
  const recovered = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: report.content,
    maskIdentifiers: report.maskIdentifiers,
    excludedFileIds: report.excludedFileIds,
  });
  expect(recovered.content).toBe(report.content);
  expect(
    new Uint8Array(
      await new Response((await f.reports.pdf(f.actor.ownerId, recovered.id)).body).arrayBuffer(),
    ).slice(0, 5),
  ).toEqual(new TextEncoder().encode("%PDF-"));
  f.db.close();
});

test("corrected material facts retain user-edit attribution", async () => {
  const f = await reportFixture(),
    u = await readyFile(f, "원본에는 합성 금액 500만원이라고 적혀 있습니다.");
  const fact: V2ReportBody["facts"][number] = {
    id: crypto.randomUUID(),
    text: "합성 금액은 750만원입니다.",
    attribution: "user_material",
    certainty: "uncertain",
    significance: "neutral",
    references: [
      {
        kind: "user_material",
        fileId: u.session.fileId,
        fileRevision: 2,
        position: { kind: "document", page: 1, paragraph: 1, table: null },
      },
    ],
    conflictingFactIds: [],
    userEdited: true,
  };
  await summary(f, [fact], "합성 금액 확인 사건");
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const canonical = await createV2ReportsRepository(f.core).read(f.actor, report.id);
  expect(canonical?.body.facts[0]?.userEdited).toBe(true);
  expect(report.content).toContain(`${fact.text}\n[사용자 교정 · 자료 관찰 · 미확인`);
  const factSection = report.content.split("사실·주장·출처")[1]?.split("미확인 사항")[0] ?? "";
  expect(factSection).toContain("사용자 교정");
  const { reportText, buildReportSource } = await import("../src/server/modules/reports/source");
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const withFlag = reportText(source.body, source.coverage);
  const withoutFlag = reportText(
    { ...source.body, facts: source.body.facts.map((x) => ({ ...x, userEdited: false })) },
    source.coverage,
  );
  expect(withFlag).not.toBe(withoutFlag);
  const html = await f.reports.html(f.actor.ownerId, report.id);
  expect(html).toContain(fact.text);
  expect(html).toContain("[사용자 교정 · 자료 관찰 · 미확인");
  f.db.close();
});
