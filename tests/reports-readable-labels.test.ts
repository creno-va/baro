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
function pdfText(raw: string) {
  const glyphs = new Map(
    [...raw.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g)]
      .filter((m) => m[2] !== "FFFF")
      .map((m) => [
        m[1],
        String.fromCharCode(...((m[2] ?? "").match(/.{4}/g) ?? []).map((x) => parseInt(x, 16))),
      ]),
  );
  return [...raw.matchAll(/<([0-9a-f]+)> Tj/g)]
    .map((m) => ((m[1] ?? "").match(/.{4}/g) ?? []).map((cid) => glyphs.get(cid) ?? "").join(""))
    .join("\n");
}

test("report labels follow actual encrypted question rounds and localize action state without changing provenance", async () => {
  const f = await fixture();
  const selected = await readyFile(f, "합성 리포트 표시 검증 원본");
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const beforeDigest = await sourceDigest(f.core, f.actor, f.workspaceId);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  for (const question of f.questions) {
    expect(report.content).toContain(
      `${question.text}\n[사용자 진술 · ${question.round}차 질문 ${question.number}번 답변]`,
    );
    expect(report.content).not.toContain(question.id);
  }
  for (const [state, label] of [
    ["todo", "진행 전"],
    ["done", "완료"],
    ["skipped", "건너뜀"],
  ])
    expect(report.content).toContain(`합성 행동 ${state} (${label})`);
  expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(beforeDigest);
  expect(report.content).toContain("질문: 합성 1차 1번 질문");
  expect(report.content).toContain("질문: 합성 2차 3번 질문");
  const stored = await createV2ReportsRepository(f.core).read(f.actor, report.id);
  expect(stored?.body).toEqual(source.body);
  const html = await f.reports.html(f.actor.ownerId, report.id);
  expect(html).toContain("2차 질문 3번 답변");
  expect(html).toContain("합성 행동 todo (진행 전)");
  const pdf = await f.reports.pdf(f.actor.ownerId, report.id);
  const text = pdfText(await new Response(pdf.body).text());
  expect(text).toContain("2차 질문 3번 답변");
  expect(text).toContain("합성 행동 todo (진행 전)");
  const manual = `사용자 편집본 todo · ${f.questions[0]?.id}`;
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
  expect(generated.content).toContain("2차 질문 3번 답변");
  expect(await f.reports.html(f.actor.ownerId, saved.id)).toContain(manual);
  const excluded = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: generated.revision,
    content: generated.content,
    maskIdentifiers: false,
    excludedFileIds: [selected.session.fileId],
  });
  expect(excluded.content).toContain("2차 질문 3번 답변");
  expect(excluded.content).toContain("합성 행동 todo (진행 전)");
});

test("historical body without display context hides internal answer and message IDs without inventing question order", async () => {
  const f = await fixture();
  const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
  const messageId = crypto.randomUUID();
  const body = structuredClone(source.body);
  body.facts[0]?.references.push({ kind: "user_message", messageId, workspaceRevision: 1 });
  const original = structuredClone(body);
  const text = reportText(body, source.coverage);
  expect(text).toContain("추가 질문에 대한 답변");
  expect(text).toContain("추가 대화의 사용자 진술");
  expect(text).not.toContain("차 질문");
  expect(text).not.toContain(messageId);
  for (const question of f.questions) expect(text).not.toContain(question.id);
  expect(body).toEqual(original);
  expect(text).not.toContain("입력 버전");
  expect(text).not.toContain("진술됨");
});

for (const condition of ["wrong_revision", "unknown_question", "duplicate_question"] as const)
  test(`display metadata ${condition} never invents a question position or exposes an ID`, async () => {
    const f = await fixture();
    const source = await buildReportSource(f.core, f.actor, f.workspaceId, []);
    const display = {
      intakeRevision: source.display.intakeRevision,
      questions: source.display.questions.map((question) => ({ ...question })),
    };
    const body = structuredClone(source.body);
    const first = body.facts[0]?.references[0];
    if (first?.kind !== "intake_answer") throw new Error("Missing synthetic answer reference");
    if (condition === "wrong_revision") display.intakeRevision++;
    if (condition === "unknown_question") first.questionId = crypto.randomUUID();
    if (condition === "duplicate_question") {
      const match = display.questions.find((q) => q.id === first.questionId);
      if (!match) throw new Error("Missing synthetic display question");
      display.questions = [...display.questions, { ...match, round: 3, number: 2 }];
    }
    const original = structuredClone(body);
    const text = reportText(body, source.coverage, display);
    expect(text).toContain(`${body.facts[0]?.text}\n[사용자 진술 · 추가 질문에 대한 답변]`);
    expect(text).not.toContain(first.questionId);
    expect(body).toEqual(original);
    expect(text).not.toContain("입력 버전");
    expect(text).not.toContain("진술됨");
  });
