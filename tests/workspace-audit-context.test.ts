import { expect, test } from "bun:test";
import type { V2Fact, V2Message, V2Summary, V2UserMessage } from "../src/contracts/v2";
import { snapshotStatements } from "../src/server/db/v2-core";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { workspaceModelInput } from "../src/server/modules/workspace/pipeline";
import { reportFixture } from "./helpers/report-fixture";

// Reconstruct the six-fact/edited-material/history shape with synthetic data.
// This checks actual SQLite/AES context assembly, not a captured provider verdict.
test("current six facts retain correction authority while dated assistant history stays separate from source messages", async () => {
  const f = await reportFixture();
  try {
    const statements = [
      "합성 검증 사건이며 실제 인물이나 계약은 없습니다.",
      "계약 종료일을 2026년 9월 30일로 가정합니다.",
      "보증금을 아직 받지 못했다고 가정합니다.",
      "계약서와 이체내역이 있다고 가정합니다.",
      "추가 합의 여부는 모릅니다.",
    ];
    const facts: V2Fact[] = statements.map((text, index) => ({
      id: `synthetic_current_${index}`,
      text,
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    }));
    facts.push({
      id: "synthetic_edited_material",
      text: "합성 PDF 1쪽에서 처리 표식 BLUE BOX 17을 확인했습니다. 실제 사건 자료가 아닌 기능 검증용 표식입니다. 저장 상태 확인용 합성 문장입니다.",
      attribution: "user_material",
      certainty: "uncertain",
      significance: "neutral",
      references: [
        {
          kind: "user_material",
          fileId: "synthetic_unselected_pdf",
          fileRevision: 2,
          position: { kind: "document", page: 1, paragraph: null, table: null },
        },
      ],
      conflictingFactIds: [],
      userEdited: true,
    });
    const summary: V2Summary = {
      schemaVersion: "2",
      revision: 5,
      intakeRevision: 1,
      createdAt: "2026-10-15T03:00:00.000Z",
      overview: "합성 사건의 가정과 사용자 교정의 미확인 상태를 구분합니다.",
      facts,
      parties: [],
      unknowns: ["추가 합의 여부 미확인"],
      notices: ["실제 사건이 아닌 합성 검증"],
    };
    const claimId = crypto.randomUUID(),
      snapshotId = crypto.randomUUID();
    await f.core.binding.batch([
      f.core.claim({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() }, claimId),
      ...(await snapshotStatements(
        f.core,
        {
          id: snapshotId,
          ownerId: f.actor.ownerId,
          workspaceId: f.workspaceId,
          targetId: f.workspaceId,
          revision: summary.revision,
          purpose: "summary",
          now: f.actor.now,
        },
        summary,
        claimId,
      )),
      f.core.finish(claimId),
    ]);
    const intake = await f.core.encrypt("v2_intakes", f.workspaceId, f.actor.ownerId, 1, {
      narrative: statements.join(" "),
    });
    f.db.sqlite
      .query("UPDATE v2_intakes SET encrypted_payload=?,confirmed_summary_revision=5 WHERE id=?")
      .run(intake, f.workspaceId);
    f.db.sqlite
      .query("UPDATE v2_workspaces SET confirmed_summary_revision=5 WHERE id=?")
      .run(f.workspaceId);
    f.db.sqlite
      .query("UPDATE v2_summaries SET revision=5,snapshot_id=? WHERE workspace_id=?")
      .run(snapshotId, f.workspaceId);
    for (const [index, fact] of facts.entries()) {
      const id = `synthetic_fact_row_${index}`;
      const payload = await f.core.encrypt("v2_facts", id, f.actor.ownerId, 5, fact);
      f.db.sqlite
        .query(
          "INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) VALUES(?,?,?,5,5,?,?)",
        )
        .run(id, fact.id, f.workspaceId, snapshotId, payload);
    }
    const firstFact = facts[0];
    if (!firstFact) throw new Error("Missing synthetic fact");
    const oldFact = { ...firstFact, text: "이전 요약의 교체된 합성 진술입니다." };
    const oldPayload = await f.core.encrypt(
      "v2_facts",
      "synthetic_old_fact_row",
      f.actor.ownerId,
      4,
      oldFact,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) VALUES(?,?,?,4,4,?)",
      )
      .run("synthetic_old_fact_row", firstFact.id, f.workspaceId, oldPayload);
    const history: V2Message[] = [
      {
        schemaVersion: "2",
        id: "synthetic_old_assistant",
        operationId: "synthetic_old_operation",
        workspaceRevision: 1,
        createdAt: "2026-10-14T23:00:00.000Z",
        role: "assistant",
        safety: "validated",
        text: "오늘은 2026년 10월 14일입니다.",
        references: [],
        citations: [],
        warnings: [],
      },
      {
        schemaVersion: "2",
        id: "synthetic_date_correction",
        operationId: "synthetic_correction_operation",
        workspaceRevision: 2,
        createdAt: "2026-10-15T03:23:00.000Z",
        role: "user",
        text: "한국 날짜를 확인해 주세요.",
        selectedFileIds: [],
      },
      {
        schemaVersion: "2",
        id: "synthetic_corrected_assistant",
        operationId: "synthetic_correction_operation",
        workspaceRevision: 3,
        createdAt: "2026-10-15T03:24:00.000Z",
        role: "assistant",
        safety: "validated",
        text: "한국 날짜는 2026년 10월 15일입니다.",
        references: [],
        citations: [],
        warnings: [],
      },
    ];
    for (const message of history) {
      f.db.sqlite
        .query(
          "INSERT OR IGNORE INTO v2_operations(id,owner_id,workspace_id,kind,state,created_at) VALUES(?,?,?,'chat','completed',?)",
        )
        .run(message.operationId, f.actor.ownerId, f.workspaceId, message.createdAt);
      const payload = await f.core.encrypt("v2_messages", message.id, f.actor.ownerId, 1, message);
      f.db.sqlite
        .query(
          "INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,safety,encrypted_payload,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          message.id,
          f.workspaceId,
          message.workspaceRevision,
          message.operationId,
          message.role,
          message.role === "assistant" ? message.safety : null,
          payload,
          message.createdAt,
        );
    }
    const latest: V2UserMessage = {
      schemaVersion: "2",
      id: "synthetic_latest_request",
      operationId: "synthetic_latest_operation",
      workspaceRevision: 4,
      createdAt: "2026-10-17T08:25:16.908Z",
      role: "user",
      text: "이 합성 사건에서 소송 전략을 알려 주세요. 제공 범위를 벗어나면 그 점을 명확히 말하고, 확인된 사실과 준비할 자료만 정리해 주세요.",
      selectedFileIds: [],
    };
    const context = await readWorkspaceContext(
      f.core,
      { ...f.actor, now: latest.createdAt },
      f.workspaceId,
      latest,
    );
    expect(context.confirmedSummary?.revision).toBe(5);
    expect(context.facts).toHaveLength(6);
    expect(context.facts.some((fact) => fact.text === oldFact.text)).toBe(false);
    expect(context.facts.find((fact) => fact.userEdited)).toEqual(facts[5]);
    expect(context.confirmedSummary?.facts).toEqual(context.facts);
    expect(context.intake.summary?.facts).toEqual(context.facts);
    expect(
      context.history?.map(({ role, workspaceRevision }) => ({ role, workspaceRevision })),
    ).toEqual([
      { role: "assistant", workspaceRevision: 3 },
      { role: "user", workspaceRevision: 2 },
      { role: "assistant", workspaceRevision: 1 },
    ]);
    expect(context.history?.map((message) => message.text)).toEqual(
      history.toReversed().map((message) => message.text),
    );
    expect(
      context.history?.every((message) => message.createdAt === "1970-01-01T00:00:00.000Z"),
    ).toBe(true);
    expect(context.messages.map((message) => message.id)).toEqual(["synthetic_date_correction"]);
    expect(context.references.messages.map((message) => message.id)).toEqual([
      "synthetic_date_correction",
      latest.id,
    ]);
    expect(context.materials).toEqual([]);
    expect(context.references.files).toEqual([]);
    expect(context.calendar).toEqual({ localDate: "2026-10-17", timeZone: "Asia/Seoul" });
    const projected = workspaceModelInput(context);
    const audit = workspaceModelInput({ phase: "workspace_chat", context, draft: {} });
    expect(audit).toEqual({ phase: "workspace_chat", context: projected, draft: {} });
    expect(projected).not.toHaveProperty("sourceRetrieval");
    expect(projected).not.toHaveProperty("actions");
    expect(projected).not.toHaveProperty("timeline");
  } finally {
    f.db.close();
  }
});
