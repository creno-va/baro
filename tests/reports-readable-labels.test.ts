import { afterEach, expect, test } from "bun:test";
import type { V2ReportBody } from "../src/contracts/v2";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { buildReportSource, reportText, sourceDigest } from "../src/server/modules/reports/source";
import { readyFile, reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  const questions: { id: string; round: number; number: number; text: string }[] = [];
  // Persist real encrypted batches in reverse insertion order. Display numbering
  // must follow the canonical round/question order, never fact IDs or ref order.
  for (const round of [2, 1]) {
    const id = crypto.randomUUID();
    const batch = {
      id,
      ordinal: round,
      generatedForIntakeRevision: 1,
      questions: Array.from({ length: 3 }, (_, index) => ({
        id: crypto.randomUUID(),
        prompt: `합성 ${round}차 ${index + 1}번 질문`,
        answerType: "text",
        options: [],
      })),
      answers: [],
    };
    f.db.sqlite
      .query(
        "INSERT INTO v2_question_batches(id,workspace_id,ordinal,intake_revision,question_count,encrypted_payload,created_at) VALUES(?,?,?,1,3,?,?)",
      )
      .run(
        id,
        f.workspaceId,
        round,
        await f.core.encrypt("v2_question_batches", id, f.actor.ownerId, 1, batch),
        f.actor.now,
      );
    for (const [index, question] of batch.questions.entries()) {
      const answerId = crypto.randomUUID(),
        text = `합성 답변 ${round}-${index + 1}`;
      f.db.sqlite
        .query(
          "INSERT INTO v2_answers(id,batch_id,question_id,status,encrypted_payload,updated_at) VALUES(?,?,?,'answered',?,?)",
        )
        .run(
          answerId,
          id,
          question.id,
          await f.core.encrypt("v2_answers", answerId, f.actor.ownerId, 1, {
            questionId: question.id,
            status: "answered",
            value: text,
          }),
          f.actor.now,
        );
      const factId = crypto.randomUUID();
      const fact: V2ReportBody["facts"][number] = {
        id: factId,
        text,
        attribution: "user_statement",
        certainty: "reported",
        significance: "neutral",
        userEdited: false,
        references: [{ kind: "intake_answer", questionId: question.id, intakeRevision: 1 }],
        conflictingFactIds: [],
      };
      f.db.sqlite
        .query(
          "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES(?,?,?,1,?)",
        )
        .run(
          factId,
          factId,
          f.workspaceId,
          await f.core.encrypt("v2_facts", factId, f.actor.ownerId, 1, fact),
        );
      questions.push({ id: question.id, round, number: index + 1, text });
    }
  }
  const repository = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const reference = questions[0];
  if (!reference) throw new Error("Missing synthetic question");
  for (const status of ["todo", "done", "skipped"] as const) {
    expect(
      await repository.writeAction(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        {
          id: crypto.randomUUID(),
          revision: 1,
          kind: "fact_check",
          status,
          title: `합성 행동 ${status}`,
          instructions: "합성 자료를 확인합니다.",
          caution: "실제 자료가 아닙니다.",
          factIds: [],
          references: [{ kind: "intake_answer", questionId: reference.id, intakeRevision: 1 }],
        },
        null,
      ),
    ).toBe(true);
  }
  return { ...f, questions };
}

test("lawyer-facing Markdown keeps facts, relationships and unknowns without app actions or internal reference labels", async () => {
  const f = await fixture();
  const selected = await readyFile(f, "합성 리포트 표시 검증 원본");
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const beforeDigest = await sourceDigest(f.core, f.actor, f.workspaceId);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  for (const question of f.questions) {
    expect(report.content).toContain(`- 이용자 진술 · ${question.text}`);
    expect(report.content).not.toContain(question.id);
  }
  for (const label of [
    "사건 개요",
    "당사자와 관계",
    "주요 경위",
    "주요 사실",
    "증거 자료",
    "추가 확인 사항",
  ])
    expect(report.content).toContain(label);
  for (const omitted of [
    "준비할 행동",
    "자료 처리 범위",
    "주의:",
    "출처:",
    "합성 행동 todo",
    "질문: 합성",
  ])
    expect(report.content).not.toContain(omitted);
  expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(beforeDigest);
  const stored = await createV2ReportsRepository(f.core).read(f.actor, report.id);
  expect(stored?.body).toEqual(source.body);
  expect(stored?.body.actions).toHaveLength(3);
  const html = await f.reports.html(f.actor.ownerId, report.id);
  expect(html).toContain("<li>이용자 진술 · 합성 답변");
  const manual = "사건 개요\n**직접 검토한 본문**\n- 첫 확인\n- 두 번째 확인";
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: manual,
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(manual);
  const generated = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: saved.revision,
  });
  expect(generated.content).toContain("이용자 진술 · 합성 답변");
  expect(await f.reports.html(f.actor.ownerId, saved.id)).toContain(
    "<strong>직접 검토한 본문</strong>",
  );
  const excluded = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: generated.revision,
    content: generated.content,
    maskIdentifiers: false,
    excludedFileIds: [selected.session.fileId],
  });
  expect(excluded.content).toContain("이용자 진술 · 합성 답변");
  expect(excluded.content).not.toContain("준비할 행동");
});

test("evidence exports file observations with matching fact positions and excludes hidden materials", async () => {
  const f = await reportFixture();
  fixtures.push(f);
  const u = await readyFile(f, "합성 송금 기록"),
    fileId = u.session.fileId;
  const position = { kind: "document" as const, page: 1, paragraph: 1, table: null };
  const text = "송금일자 2026-10-20 · 합성은행 · 300만원 · 이체 완료";
  for (const [ordinal, included] of [true, false].entries()) {
    const rowId = crypto.randomUUID(),
      entityId = crypto.randomUUID();
    const value = {
      id: entityId,
      text: included ? text : "제외한 민감 관찰",
      position,
      certainty: "observed",
      userEdited: false,
      included,
    };
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload) VALUES(?,?,?,2,2,?,?)",
      )
      .run(
        rowId,
        entityId,
        fileId,
        ordinal,
        await f.core.encrypt("v2_file_observations", rowId, f.actor.ownerId, 2, value),
      );
  }
  const fact: V2ReportBody["facts"][number] = {
    id: crypto.randomUUID(),
    text,
    attribution: "user_material",
    certainty: "observed",
    significance: "neutral",
    userEdited: false,
    references: [{ kind: "user_material", fileId, fileRevision: 2, position }],
    conflictingFactIds: [],
  };
  f.db.sqlite
    .query(
      "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,encrypted_payload) VALUES(?,?,?,1,?)",
    )
    .run(
      fact.id,
      fact.id,
      f.workspaceId,
      await f.core.encrypt("v2_facts", fact.id, f.actor.ownerId, 1, fact),
    );
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(report.content).toContain(`자료 기재 · ${text} (증거 1 · 1쪽 · 1번째 문단)`);
  expect(report.content).toContain("증거 자료\n### 증거 1 ·");
  expect(report.content).toContain(`- 1쪽 · 1번째 문단 · 자료 기재 · ${text}`);
  expect(report.content).not.toContain("제외한 민감 관찰");
  expect(report.content).not.toContain(fileId);
  const html = await f.reports.html(f.actor.ownerId, report.id);
  expect(html).toContain("<h2>증거 자료</h2>");
  expect(html).toContain("<h4>증거 1 ·");
  expect(html).toContain(text);
  const excluded = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: report.content,
    maskIdentifiers: false,
    excludedFileIds: [fileId],
  });
  expect(excluded.content).not.toContain(text);
  expect(excluded.content).not.toContain("### 증거 1 ·");
});

test("evidence references distinguish photos, audio intervals and sampled video without claiming authentication", async () => {
  const f = await reportFixture();
  fixtures.push(f);
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const body = structuredClone(source.body);
  const positions = [
    { kind: "image" as const, region: null },
    { kind: "audio" as const, startSeconds: 12.5, endSeconds: 19.25 },
    {
      kind: "video" as const,
      timestampSeconds: 24,
      frameIndex: 48,
      sampling: "scene_change" as const,
    },
  ];
  body.selectedFiles = positions.map((_, i) => ({
    id: `file-${i}`,
    revision: 2,
    name: ["합성 사진.jpg", "합성 녹취.wav", "합성 영상.mp4"][i]!,
    byteLength: 100,
    contentHash: "a".repeat(64),
  }));
  body.facts = positions.map((position, i) => ({
    id: `fact-${i}`,
    text: `합성 관찰 ${i}`,
    attribution: "user_material",
    certainty: i === 1 ? "uncertain" : "observed",
    significance: "neutral",
    references: [{ kind: "user_material", fileId: `file-${i}`, fileRevision: 2, position }],
    conflictingFactIds: [],
    userEdited: i === 1,
  }));
  const text = reportText(body, [], {
    ...source.display,
    materials: body.selectedFiles.map((file) => ({
      id: file.id,
      observations: ["확인 필요 · 합성 판독"],
    })),
  });
  expect(text).toContain("증거 1 · 이미지 관찰");
  expect(text).toContain("확인 필요 · 직접 수정 · 합성 관찰 1 (증거 2 · 12.5–19.25초)");
  expect(text).toContain("증거 3 · 24초 · 프레임 48 · 장면 전환 표본");
  expect(text).not.toContain("사실 확인됨");
  body.selectedFiles[0]!.revision = 3;
  expect(reportText(body, [], source.display)).not.toContain("(증거 1 · 이미지 관찰)");
});

test("source display never invents question positions or exposes internal IDs, and retains canonical provenance", async () => {
  const f = await fixture();
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const body = structuredClone(source.body),
    original = structuredClone(source.body);
  const text = reportText(body, source.coverage);
  for (const question of f.questions) expect(text).not.toContain(question.id);
  expect(text).not.toContain("차 질문");
  expect(text).toContain("이용자 진술 · 합성 답변");
  expect(body).toEqual(original);
});
