import { expect, test } from "bun:test";
import type { V2Fact, V2UserMessage } from "../src/contracts/v2";
import { loadReconciliationSource } from "../src/server/modules/rework/reconciliation-source";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { reportFixture } from "./helpers/report-fixture";

async function fixture() {
  const f = await reportFixture();
  for (let i = 0; i < 10; i++) {
    const id = crypto.randomUUID();
    const fact: V2Fact = {
      id,
      text: `확인한 합성 거래 사실 ${i}`,
      attribution: "user_statement",
      certainty: "reported",
      significance: i === 9 ? "unfavorable" : "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    };
    const encrypted = await f.core.encrypt("v2_facts", id, f.actor.ownerId, 1, fact);
    f.db.sqlite
      .query(
        "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,revision,encrypted_payload) VALUES(?,?,?,1,1,?)",
      )
      .run(id, id, f.workspaceId, encrypted);
  }
  const actor = { ...f.actor, caseId: f.workspaceId };
  return { ...f, actor };
}
async function message(f: Awaited<ReturnType<typeof fixture>>, reconciliation: boolean) {
  const id = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    revision = f.rev() + 1;
  f.db.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) VALUES(?,?,?,'chat',?,?)",
    )
    .run(operationId, f.actor.ownerId, f.workspaceId, revision, f.actor.now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_idempotency(owner_id,route,key,request_hash,operation_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      f.actor.ownerId,
      `/api/v2/cases/${f.workspaceId}/${reconciliation ? "rework/tasks/summary_reconciliation" : "messages"}`,
      crypto.randomUUID(),
      "a".repeat(64),
      operationId,
      f.actor.now,
      "2026-10-07T00:00:00.000Z",
    );
  const value: V2UserMessage = {
    schemaVersion: "2",
    id,
    operationId,
    workspaceRevision: revision,
    createdAt: f.actor.now,
    role: "user",
    text: "추가 설명을 원문과 함께 확인합니다.",
    selectedFileIds: [],
  };
  f.db.sqlite
    .query(
      "INSERT INTO v2_messages(id,workspace_id,operation_id,workspace_revision,role,revision,encrypted_payload,created_at) VALUES(?,?,?,?,'user',1,?,?)",
    )
    .run(
      id,
      f.workspaceId,
      operationId,
      revision,
      await f.core.encrypt("v2_messages", id, f.actor.ownerId, 1, value),
      f.actor.now,
    );
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=? WHERE id=?").run(revision, f.workspaceId);
  return value;
}
test("reconciliation reads all canonical facts beyond the generic eight-row context and preserves coverage truth", async () => {
  const f = await fixture();
  try {
    const generic = await readWorkspaceContext(f.core, f.actor, f.workspaceId);
    expect(generic.facts).toHaveLength(8);
    expect(generic.contextCoverage?.factsPartial).toBe(true);
    const source = await loadReconciliationSource(f.core, f.actor, { write: false });
    expect(source.summary.facts).toHaveLength(10);
    expect(source.context.intake.summary).toEqual(source.summary);
    expect(source.context.facts).toEqual(source.summary.facts);
    expect(source.context.facts.some((fact) => fact.significance === "unfavorable")).toBe(true);
    expect(source.context.contextCoverage?.factsPartial).toBe(false);
    expect(source.context.contextCoverage?.sourcesPartial).toBe(
      generic.contextCoverage?.sourcesPartial,
    );
    expect(source.summaryId).not.toBe(source.summarySnapshotId);
    expect(source.context.conversation?.caseContext.casePurpose).toBe("unconfirmed");
  } finally {
    f.db.close();
  }
});
test("issued correction admission leaves semantic digest stable; ordinary statements change it", async () => {
  const f = await fixture();
  try {
    const before = await loadReconciliationSource(f.core, f.actor, { write: false });
    const issued = await message(f, true);
    const correction = await loadReconciliationSource(f.core, f.actor, {
      write: true,
      requestMessage: issued,
    });
    expect(correction.sourceDigest).toBe(before.sourceDigest);
    expect(correction.context.latestMessage?.id).toBe(issued.id);
    expect(correction.context.latestMessage?.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(issued.createdAt).toBe(f.actor.now);
    await message(f, false);
    expect(
      (await loadReconciliationSource(f.core, f.actor, { write: false })).sourceDigest,
    ).not.toBe(before.sourceDigest);
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    expect(
      (await loadReconciliationSource(f.core, f.actor, { write: false })).summary.facts,
    ).toHaveLength(10);
    await expect(loadReconciliationSource(f.core, f.actor, { write: true })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    await expect(
      loadReconciliationSource(f.core, { ...f.actor, ownerId: "peer" }, { write: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    f.db.close();
  }
});
