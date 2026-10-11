import { expect, test } from "bun:test";
import type { V2Fact, V2UserMessage } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import {
  createWorkspacePipeline,
  type WorkspaceContext,
} from "../src/server/modules/workspace/pipeline";
import { readyFile, reportFixture } from "./helpers/report-fixture";

const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
function latest(
  f: Awaited<ReturnType<typeof reportFixture>>,
  text: string,
  selectedFileIds: string[] = [],
): V2UserMessage {
  return {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "user",
    text,
    selectedFileIds,
  };
}
function fact(m: V2UserMessage, text: string): V2Fact {
  return {
    id: crypto.randomUUID(),
    text,
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    userEdited: false,
    conflictingFactIds: [],
    references: [{ kind: "user_message", messageId: m.id, workspaceRevision: m.workspaceRevision }],
  };
}
function draft(facts: V2Fact[] = [], timeline: unknown[] = []) {
  return {
    text: "합성 사실을 정리했습니다.",
    facts,
    timeline,
    references: [],
    warnings: [],
    actions: [],
    parties: [],
    requestedSources: [],
  };
}
function pipeline(reply: unknown | ((context: WorkspaceContext) => unknown)) {
  return createWorkspacePipeline(
    {
      call: async (phase, context) =>
        phase === "workspace_audit"
          ? approved
          : typeof reply === "function"
            ? reply(context as WorkspaceContext)
            : reply,
    } as Parameters<typeof createWorkspacePipeline>[0],
    { reserve: async () => true, invocation: () => crypto.randomUUID() },
  );
}
// Regression coverage for reviewed #64 boundaries; SQL/AES/R2 are isolated synthetic fixtures.
test("chat conflicts link existing facts and reject unknown IDs", async () => {
  const f = await reportFixture();
  try {
    const m = latest(f, "아직 대금을 받지 못했습니다.");
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, m);
    const previous = fact(m, "대금을 받았습니다.");
    context.facts = [previous];
    const changed = {
      ...fact(m, m.text),
      certainty: "conflicting" as const,
      conflictingFactIds: [previous.id],
    };
    const accepted = await pipeline(draft([changed])).chat(context, crypto.randomUUID());
    expect(accepted.facts[0]?.conflictingFactIds).toEqual([previous.id]);
    await expect(
      pipeline(draft([{ ...changed, conflictingFactIds: [crypto.randomUUID()] }])).chat(
        context,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "POLICY_REJECTED" });
  } finally {
    f.db.close();
  }
});
test("another event date cannot increase the linked payment precision", async () => {
  const f = await reportFixture();
  try {
    const m = latest(
      f,
      "대금 지급은 2025년이며 월과 일은 모릅니다. 이후 2025년 5월 17일에 독촉했습니다.",
    );
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, m);
    const payment = fact(m, "대금 지급은 2025년이며 월과 일은 모릅니다.");
    const entry = {
      id: crypto.randomUUID(),
      revision: 1,
      date: "2025-05-17",
      datePrecision: "day",
      event: "대금 지급",
      certainty: "reported",
      references: payment.references,
      factIds: [payment.id],
      userEdited: false,
    };
    const result = await pipeline(draft([payment], [entry])).chat(context, crypto.randomUUID());
    expect(result.timeline[0]).toMatchObject({ date: "2025-01-01", datePrecision: "year" });
    expect(result.warnings).toHaveLength(1);
  } finally {
    f.db.close();
  }
});
test.each([
  ["uncertain", false, "observed", "uncertain"],
  ["uncertain", false, "reported", "uncertain"],
  ["uncertain", true, "observed", "uncertain"],
  ["observed", false, "observed", "observed"],
] as const)(
  "material certainty %s, edited %s, proposed %s preserves source status",
  async (certainty, userEdited, proposedCertainty, expected) => {
    const f = await reportFixture();
    try {
      const upload = await readyFile(f, "synthetic original");
      const fileId = upload.session.fileId;
      const row = f.db.sqlite
        .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
        .get(fileId) as { revision: number; coverage_snapshot_id: string };
      const id = crypto.randomUUID(),
        entity = crypto.randomUUID();
      const observation = {
        id: entity,
        text: "합성 자료에는 대금 지급이라고 적혀 있습니다.",
        position: { kind: "document", page: 1, paragraph: 1, table: null },
        certainty,
        userEdited,
        included: true,
      };
      const encrypted = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        row.revision,
        observation,
      );
      f.db.sqlite
        .query(
          "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          entity,
          fileId,
          row.revision,
          row.revision,
          0,
          encrypted,
          row.coverage_snapshot_id,
        );
      const m = latest(f, "선택 자료를 정리해주세요.", [fileId]);
      const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, m);
      expect(context.materials[0]?.coverage).toMatchObject({
        userEdited,
        observationCertainty: certainty,
      });
      const material = context.materials[0];
      if (!material) throw new Error("Missing synthetic material");
      const proposed: V2Fact = {
        id: crypto.randomUUID(),
        text: observation.text,
        attribution: "user_material",
        certainty: proposedCertainty,
        significance: "neutral",
        userEdited: false,
        references: [material.reference],
        conflictingFactIds: [],
      };
      const result = await pipeline(draft([proposed])).chat(context, crypto.randomUUID());
      expect(result.facts[0]).toMatchObject({ certainty: expected, userEdited: false });
      expect(result.warnings).toHaveLength(proposedCertainty === expected ? 0 : 1);
    } finally {
      f.db.close();
    }
  },
);
test("new model facts cannot impersonate manual user edits", async () => {
  const f = await reportFixture();
  try {
    const m = latest(f, "자료를 보관하고 있습니다.");
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, m);
    const forged = { ...fact(m, m.text), userEdited: true };
    const result = await pipeline(draft([forged])).chat(context, crypto.randomUUID());
    expect(result.facts[0]?.userEdited).toBe(false);
  } finally {
    f.db.close();
  }
});
test("v2 chat publishes a new immutable summary and requires explicit confirmation before AI/report use", async () => {
  const f = await reportFixture();
  try {
    const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
    const before = await repo.readIntake(f.actor, f.workspaceId);
    const initialReport = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const jobs = createV2JobsRepository(f.core),
      jobId = crypto.randomUUID(),
      operationId = crypto.randomUUID();
    const text = "새로 확인한 합성 자료 보관 사실입니다.";
    expect(
      await jobs.admitWorkspace(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        { operationId, key: crypto.randomUUID(), requestHash: "c".repeat(64) },
        jobId,
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: { text, selectedFileIds: [], expectedRevision: f.rev() },
        },
      ),
    ).toBe(true);
    const runtime = f.db.sqlite
      .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
      .get(jobId) as { runtime_instance_id: string };
    const params = {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      workspaceRevision: f.rev(),
      jobId,
    };
    const outcome = await executeWorkspace(f.core, params, runtime.runtime_instance_id, {
      clock: () => f.actor.now,
      authorize: async () => true,
      pipeline: async () =>
        pipeline((c: WorkspaceContext) => {
          if (!c.latestMessage) throw new Error("Missing synthetic message");
          return draft([fact(c.latestMessage, text)]);
        }),
    });
    expect(outcome.status).toBe("completed");
    const after = await repo.readIntake(f.actor, f.workspaceId);
    expect(after?.summary?.facts.some((item) => item.text === text)).toBe(true);
    expect(after?.summary?.revision).toBe((before?.summary?.revision ?? 0) + 1);
    expect(after?.confirmedSummaryRevision).toBeNull();
    expect(after?.status).toBe("reviewing_summary");
    if (!after?.summary) throw new Error("Missing proposed summary");
    const pending = await readWorkspaceContext(
      f.core,
      f.actor,
      f.workspaceId,
      latest(f, "계속 정리해주세요."),
    );
    await expect(pipeline(draft()).chat(pending, crypto.randomUUID())).rejects.toMatchObject({
      code: "POLICY_REJECTED",
    });
    await expect(
      f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: initialReport.revision,
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(
      await repo.confirmSummary(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
        { expectedRevision: after.revision, summaryRevision: after.summary.revision },
      ),
    ).toBe(true);
    const report = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: initialReport.revision,
    });
    expect(report.content).toContain(text);
    expect(report.basis.summaryRevision).toBe(after?.summary?.revision);
  } finally {
    f.db.close();
  }
});
test("report text preserves year/month precision without invented calendar days", async () => {
  const f = await reportFixture();
  try {
    const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
    for (const [date, datePrecision, event] of [
      ["2025-01-01", "year", "연도만 확인한 사건"],
      ["2025-05-01", "month", "월까지만 확인한 사건"],
    ] as const) {
      expect(
        await repo.writeTimeline(
          { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
          {
            id: crypto.randomUUID(),
            revision: 1,
            date,
            datePrecision,
            event,
            certainty: "reported",
            references: [],
            factIds: [],
            userEdited: true,
          },
          null,
        ),
      ).toBe(true);
    }
    const saved = await repo.timeline(f.actor, f.workspaceId);
    expect(saved.map((item) => item.datePrecision).sort()).toEqual(["month", "year"]);
    const initial = await f.reports.get(f.actor.ownerId, f.workspaceId);
    const report = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: initial.revision,
    });
    expect(report.content).toContain("2025년 · 연도만 확인한 사건");
    expect(report.content).not.toContain("2025-01-01 · 연도만 확인한 사건");
    expect(report.content).toContain("2025-05 · 월까지만 확인한 사건");
    expect(report.content).not.toContain("2025-05-01 · 월까지만 확인한 사건");
  } finally {
    f.db.close();
  }
});

test("unlinked multi-event dates stay unknown; linked exact event dates remain usable", async () => {
  const f = await reportFixture();
  try {
    const m = latest(f, "대금 지급은 2025년이고 독촉은 2025년 5월 17일입니다.");
    const c = await readWorkspaceContext(f.core, f.actor, f.workspaceId, m);
    const demand = fact(m, "독촉은 2025년 5월 17일입니다.");
    const entry = {
      id: crypto.randomUUID(),
      revision: 1,
      date: "2025-05-17",
      datePrecision: "day",
      event: "독촉",
      certainty: "reported",
      references: demand.references,
      factIds: [],
      userEdited: false,
    };
    expect(
      (await pipeline(draft([], [entry])).chat(c, crypto.randomUUID())).timeline[0],
    ).toMatchObject({ date: null, datePrecision: "unknown" });
    expect(
      (
        await pipeline(draft([demand], [{ ...entry, factIds: [demand.id] }])).chat(
          c,
          crypto.randomUUID(),
        )
      ).timeline[0],
    ).toMatchObject({ date: "2025-05-17", datePrecision: "day" });
  } finally {
    f.db.close();
  }
});

test("large chat summary streams every old fact, escapes and Unicode without reusing confirmation", async () => {
  const { createV2StagingRepository } = await import("../src/server/db/v2-staging");
  const { fragmentText, utf8Bytes } = await import("../src/server/db/v2-core");
  const f = await reportFixture();
  try {
    const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
    const original = await repo.readIntake(f.actor, f.workspaceId);
    if (!original?.summary) throw new Error("Missing summary");
    const oldFacts: V2Fact[] = Array.from({ length: 190 }, (_, i) => ({
      id: crypto.randomUUID(),
      text: `${i}: ${"가".repeat(1850)} · "인용" \\ 줄바꿈\n😀`,
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: original.revision }],
      conflictingFactIds: [],
      userEdited: false,
    }));
    const source = { ...original.summary, revision: 2, facts: oldFacts };
    const sourceText = JSON.stringify(source);
    expect(utf8Bytes(sourceText)).toBeGreaterThan(1048576);
    const parts = fragmentText(sourceText),
      snapshotId = crypto.randomUUID();
    const staging = createV2StagingRepository(f.core);
    const g = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
    expect(
      await staging.begin(g(), {
        id: snapshotId,
        purpose: "summary",
        targetId: f.workspaceId,
        revision: 2,
        partCount: parts.length,
        byteLength: utf8Bytes(sourceText),
      }),
    ).toBe(true);
    for (const [index, text] of parts.entries())
      expect(await staging.append(g(), snapshotId, index, text)).toBe(true);
    expect(
      await staging.seal(g(), snapshotId, {
        schemaVersion: "2",
        purpose: "summary",
        targetId: f.workspaceId,
        revision: 2,
      }),
    ).toBe(true);
    expect(await staging.publish(g(), snapshotId)).toBe(true);
    f.db.sqlite
      .query("UPDATE v2_summaries SET snapshot_id=?,revision=2 WHERE workspace_id=? AND revision=1")
      .run(snapshotId, f.workspaceId);
    f.db.sqlite
      .query("UPDATE v2_workspaces SET confirmed_summary_revision=2 WHERE id=?")
      .run(f.workspaceId);
    f.db.sqlite
      .query("UPDATE v2_intakes SET confirmed_summary_revision=2 WHERE id=?")
      .run(f.workspaceId);
    for (const value of oldFacts) {
      const id = crypto.randomUUID(),
        payload = await f.core.encrypt("v2_facts", id, f.actor.ownerId, 2, value);
      f.db.sqlite
        .query(
          "INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,snapshot_id,encrypted_payload) VALUES(?,?,?,2,2,?,?)",
        )
        .run(id, value.id, f.workspaceId, snapshotId, payload);
    }
    const oldEncrypted = f.db.sqlite
      .query(
        "SELECT encrypted_payload FROM v2_private_parts WHERE snapshot_id=? ORDER BY part_index",
      )
      .all(snapshotId);
    const jobs = createV2JobsRepository(f.core),
      jobId = crypto.randomUUID(),
      operationId = crypto.randomUUID(),
      text = "새 합성 자료 보관 사실입니다.";
    expect(
      await jobs.admitWorkspace(
        g(),
        { operationId, key: crypto.randomUUID(), requestHash: "b".repeat(64) },
        jobId,
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: { text, selectedFileIds: [], expectedRevision: f.rev() },
        },
      ),
    ).toBe(true);
    const runtime = f.db.sqlite
      .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
      .get(jobId) as { runtime_instance_id: string };
    const params = {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      workspaceRevision: f.rev(),
      jobId,
    };
    const run = () =>
      executeWorkspace(f.core, params, runtime.runtime_instance_id, {
        clock: () => f.actor.now,
        authorize: async () => true,
        pipeline: async () =>
          pipeline((c: WorkspaceContext) => {
            if (!c.latestMessage) throw new Error("Missing message");
            return draft([fact(c.latestMessage, text)]);
          }),
      });
    expect((await run()).status).toBe("completed");
    const metadata = await repo.metadata(f.actor, f.workspaceId);
    expect(metadata?.summary?.byteLength).toBeGreaterThan(1048576);
    expect(metadata?.confirmedSummaryRevision).toBeNull();
    let combined = "";
    for await (const part of repo.summaryFragments(f.actor, f.workspaceId)) combined += part.text;
    const result = JSON.parse(combined) as { revision: number; facts: V2Fact[] };
    expect(result.revision).toBe(3);
    expect(result.facts).toHaveLength(191);
    expect(result.facts.slice(0, 190)).toEqual(oldFacts);
    expect(result.facts.at(-1)?.text).toBe(text);
    expect(
      f.db.sqlite
        .query(
          "SELECT encrypted_payload FROM v2_private_parts WHERE snapshot_id=? ORDER BY part_index",
        )
        .all(snapshotId),
    ).toEqual(oldEncrypted);
    const again = await readWorkspaceContext(f.core, f.actor, f.workspaceId);
    expect(again.contextCoverage).toMatchObject({ factsPartial: true, summaryPartial: true });
    expect(again.confirmedSummary).toBeNull();
    expect((await run()).status).toBe("completed");
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_summaries WHERE workspace_id=?")
        .get(f.workspaceId),
    ).toMatchObject({ n: 2 });
  } finally {
    f.db.close();
  }
}, 30000);

test("a stale final publication exposes neither the prepared summary nor its facts; editing can reclaim only a terminal unpublished chat stage", async () => {
  const { createV2Core } = await import("../src/server/db/v2-core");
  const { createV2WorkspaceResponseRepository } = await import(
    "../src/server/db/v2-workspace-response"
  );
  const { createV2SummaryEditsRepository } = await import("../src/server/db/v2-summary-edits");
  const f = await reportFixture();
  try {
    const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
    const before = await repo.readIntake(f.actor, f.workspaceId);
    const jobs = createV2JobsRepository(f.core),
      jobId = crypto.randomUUID(),
      operationId = crypto.randomUUID();
    const text = "새 합성 사실을 정리합니다.";
    const g = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
    expect(
      await jobs.admitWorkspace(
        g(),
        { operationId, key: crypto.randomUUID(), requestHash: "e".repeat(64) },
        jobId,
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: { text, selectedFileIds: [], expectedRevision: f.rev() },
        },
      ),
    ).toBe(true);
    const acquired = await jobs.acquire(
      f.actor,
      jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    const m = await repo.userMessage(f.actor, f.workspaceId, operationId);
    if (!acquired || m?.role !== "user") throw new Error("Missing lease/message");
    let raced = false;
    const binding = {
      prepare: f.core.binding.prepare.bind(f.core.binding),
      batch: async (statements: D1PreparedStatement[]) => {
        const sealed = f.db.sqlite
          .query(
            "SELECT id FROM v2_private_snapshots WHERE workspace_id=? AND purpose='summary' AND revision=2 AND state='sealed'",
          )
          .get(f.workspaceId);
        if (sealed && !raced) {
          raced = true;
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.workspaceId);
        }
        return f.core.binding.batch(statements);
      },
    } as D1Database;
    const core = createV2Core(binding, f.core.cipher);
    expect(
      await createV2WorkspaceResponseRepository(core).commit(g(), acquired.lease, {
        message: {
          schemaVersion: "2",
          id: crypto.randomUUID(),
          operationId,
          workspaceRevision: f.rev(),
          createdAt: f.actor.now,
          role: "assistant",
          safety: "validated",
          text: "합성 검증",
          references: [],
          citations: [],
          warnings: [],
        },
        facts: [fact(m, text)],
        parties: [],
        actions: [],
        timeline: [],
      }),
    ).toBe(false);
    expect(raced).toBe(true);
    const after = await repo.readIntake(f.actor, f.workspaceId);
    expect(after?.summary).toEqual(before?.summary);
    expect(after?.confirmedSummaryRevision).toBe(1);
    expect(
      (await repo.messages(f.actor, f.workspaceId)).filter((item) => item.role === "assistant"),
    ).toHaveLength(0);
    // A concurrent owner mutation supersedes the job; later manual edits must remain possible.
    f.db.sqlite
      .query("UPDATE v2_jobs SET status='superseded',lease_token=NULL,lease_until=NULL WHERE id=?")
      .run(jobId);
    f.db.sqlite.query("UPDATE v2_workspaces SET current_job_id=NULL WHERE id=?").run(f.workspaceId);
    const summaryId = (
      f.db.sqlite.query("SELECT summary_id FROM v2_intakes WHERE id=?").get(f.workspaceId) as {
        summary_id: string;
      }
    ).summary_id;
    const stageId = crypto.randomUUID();
    expect(
      await createV2SummaryEditsRepository(f.core).begin(g(), {
        id: stageId,
        summaryId,
        targetSnapshotId: crypto.randomUUID(),
        request: { expectedRevision: 1, overview: "수동 교정한 합성 요약" },
        expiresAt: "2026-10-06T00:15:00.000Z",
      }),
    ).toBe(true);
    expect(
      f.db.sqlite
        .query("SELECT target_revision FROM v2_summary_edit_stages WHERE id=?")
        .get(stageId),
    ).toMatchObject({ target_revision: 2 });
  } finally {
    f.db.close();
  }
});

test.each([false, true])(
  "chat with only parties changed=%s preserves the confirmation boundary",
  async (changed) => {
    const f = await reportFixture();
    try {
      const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
      const before = await repo.readIntake(f.actor, f.workspaceId);
      const jobs = createV2JobsRepository(f.core),
        jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID();
      expect(
        await jobs.admitWorkspace(
          { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
          { operationId, key: crypto.randomUUID(), requestHash: "f".repeat(64) },
          jobId,
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: f.rev(),
              text: "추가 합성 인물을 알려드립니다.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      const runtime = f.db.sqlite
        .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
        .get(jobId) as { runtime_instance_id: string };
      const response = {
        ...draft(),
        parties: changed
          ? [{ id: crypto.randomUUID(), label: "자료 보관자", role: "보관 담당" }]
          : [],
      };
      expect(
        (
          await executeWorkspace(
            f.core,
            {
              ownerId: f.actor.ownerId,
              workspaceId: f.workspaceId,
              workspaceRevision: f.rev(),
              jobId,
            },
            runtime.runtime_instance_id,
            {
              clock: () => f.actor.now,
              authorize: async () => true,
              pipeline: async () => pipeline(response),
            },
          )
        ).status,
      ).toBe("completed");
      const after = await repo.readIntake(f.actor, f.workspaceId);
      expect(after?.summary?.revision).toBe(
        changed ? (before?.summary?.revision ?? 0) + 1 : before?.summary?.revision,
      );
      expect(after?.status).toBe(changed ? "reviewing_summary" : "confirmed");
      expect(after?.confirmedSummaryRevision).toBe(
        changed ? null : before?.confirmedSummaryRevision,
      );
      expect(after?.summary?.parties).toEqual(response.parties);
    } finally {
      f.db.close();
    }
  },
);
