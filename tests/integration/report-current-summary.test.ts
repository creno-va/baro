// A/B integration: current summary and material/report contracts run together in CI.
// Uses real repositories/SQL/AES and deterministic validated AI output; no remote model calls.
import { expect, test } from "bun:test";
import type { V2Action, V2Fact, V2TimelineEntry } from "../../src/contracts/v2";
import { createV2JobsRepository } from "../../src/server/db/v2-jobs";
import { createV2SummaryEditsRepository } from "../../src/server/db/v2-summary-edits";
import { createV2WorkspaceRepository } from "../../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../../src/server/db/v2-workspace-response";
import { reportFixture } from "../helpers/report-fixture";

test("current chat facts/people and reconfirmed corrections propagate to reports with linked timeline/actions; prior PDF stays immutable", async () => {
  const f = await reportFixture(),
    a = f.actor.ownerId;
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  const ws = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const initial = await f.reports.get(a, f.workspaceId);
  const firstPdf = await f.reports.pdf(a, initial.id);
  const originalBytes = new Uint8Array(await new Response(firstPdf.body).arrayBuffer());
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
    messageId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  expect(
    await jobs.admitWorkspace(
      guard(),
      { operationId, key: crypto.randomUUID(), requestHash: "d".repeat(64) },
      jobId,
      "chat_response",
      {
        id: messageId,
        request: {
          expectedRevision: f.rev(),
          text: "추가 확인자와 자료 보관 사실을 알려드립니다.",
          selectedFileIds: [],
        },
      },
    ),
  ).toBe(true);
  const acquired = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    "2026-10-06T00:04:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic chat lease unavailable");
  const fact: V2Fact = {
    id: crypto.randomUUID(),
    text: "대화로 확인한 합성 자료 보관 사실",
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    references: [{ kind: "user_message", messageId, workspaceRevision: f.rev() }],
    conflictingFactIds: [],
    userEdited: false,
  };
  const party = { id: crypto.randomUUID(), label: "추가 자료 확인자", role: "보관 담당" };
  const action: V2Action = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "organize_materials",
    title: "연결 자료 확인",
    instructions: "보관한 자료를 확인하세요.",
    caution: "원본을 보존하세요.",
    status: "todo",
    factIds: [fact.id],
    references: fact.references,
  };
  const timeline: V2TimelineEntry = {
    id: crypto.randomUUID(),
    revision: 1,
    date: null,
    datePrecision: "unknown",
    event: "대화에서 자료 보관을 확인함",
    certainty: "reported",
    references: fact.references,
    factIds: [fact.id],
    userEdited: false,
  };
  expect(
    await createV2WorkspaceResponseRepository(f.core).commit(guard(), acquired.lease, {
      message: {
        schemaVersion: "2",
        id: crypto.randomUUID(),
        operationId,
        workspaceRevision: f.rev(),
        createdAt: f.actor.now,
        role: "assistant",
        safety: "validated",
        text: "추가 사실과 인물을 정리했어요.",
        references: [],
        citations: [],
        warnings: [],
      },
      facts: [fact],
      parties: [party],
      actions: [action],
      timeline: [timeline],
    }),
  ).toBe(true);
  const retained = await f.reports.get(a, f.workspaceId);
  expect(retained.id).toBe(initial.id);
  expect(retained.stale).toBe(true);
  expect(retained.basis).toEqual(initial.basis);
  expect(retained.content).toBe(initial.content);
  const proposed = await ws.readIntake(f.actor, f.workspaceId);
  if (!proposed?.summary) throw new Error("Missing chat summary");
  expect(proposed.status).toBe("reviewing_summary");
  expect(proposed.confirmedSummaryRevision).toBeNull();
  await expect(
    f.reports.generate(a, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: initial.revision,
    }),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  expect(
    await ws.confirmSummary(guard(), {
      expectedRevision: proposed.revision,
      summaryRevision: proposed.summary.revision,
    }),
  ).toBe(true);
  const afterChat = await f.reports.generate(a, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: initial.revision,
  });
  for (const text of [fact.text, party.label, timeline.event, action.title])
    expect(afterChat.content).toContain(text);
  expect(afterChat.stale).toBe(false);
  const summaryId = (
    f.db.sqlite.query("SELECT summary_id FROM v2_intakes WHERE id=?").get(f.workspaceId) as {
      summary_id: string;
    }
  ).summary_id;
  const edits = createV2SummaryEditsRepository(f.core),
    stageId = crypto.randomUUID();
  expect(
    await edits.begin(guard(), {
      id: stageId,
      summaryId,
      targetSnapshotId: crypto.randomUUID(),
      request: {
        expectedRevision: proposed.summary.revision,
        overview: "사용자가 다시 확인한 최신 합성 요약",
        factEdits: [{ factId: fact.id, text: "사용자가 교정한 합성 자료 보관 사실" }],
        unknowns: [],
      },
      expiresAt: "2026-10-06T00:15:00.000Z",
    }),
  ).toBe(true);
  let done = false;
  for (let i = 0; i < 100; i++) {
    const step = await edits.advance(guard(), stageId);
    expect(step).not.toBeNull();
    if (step?.done) {
      done = true;
      break;
    }
  }
  expect(done).toBe(true);
  expect(await edits.publish(guard(), stageId, crypto.randomUUID())).toBe(true);
  expect(
    await ws.confirmSummary(guard(), {
      expectedRevision: proposed.revision,
      summaryRevision: proposed.summary.revision + 1,
    }),
  ).toBe(true);
  expect(
    await ws.writeTimeline(
      guard(),
      {
        ...timeline,
        revision: 2,
        event: "교정 사실과 연결한 최신 날짜 미상 사건",
        userEdited: true,
      },
      1,
    ),
  ).toBe(true);
  expect(await ws.writeAction(guard(), { ...action, revision: 2, status: "done" }, 1)).toBe(true);
  const current = await f.reports.generate(a, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: afterChat.revision,
  });
  expect(current.basis.summaryRevision).toBe(proposed.summary.revision + 1);
  for (const text of [
    "사용자가 다시 확인한 최신 합성 요약",
    "사용자가 교정한 합성 자료 보관 사실",
    party.label,
    "교정 사실과 연결한 최신 날짜 미상 사건",
    "연결 자료 확인 (done)",
  ])
    expect(current.content).toContain(text);
  expect(current.content).not.toContain(fact.text);
  const oldPdf = await f.reports.pdf(a, initial.id);
  expect(new Uint8Array(await new Response(oldPdf.body).arrayBuffer())).toEqual(originalBytes);
});
