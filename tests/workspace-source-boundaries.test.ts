import { expect, test } from "bun:test";
import type { V2Fact, V2UserMessage } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createFileReviewService } from "../src/server/modules/files/review";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import {
  assertWorkspaceFacts,
  createWorkspacePipeline,
  WorkspaceOutputPolicyError,
} from "../src/server/modules/workspace/pipeline";
import { hasCustomerWorkspaceAccess } from "../src/server/runtime/workspace";
import { readyFile, reportFixture } from "./helpers/report-fixture";

function message(
  f: Awaited<ReturnType<typeof reportFixture>>,
  text: string,
  files: string[] = [],
): V2UserMessage {
  return {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "user",
    text,
    selectedFileIds: files,
  };
}

test("published material exclusions never enter workspace AI context; included corrections and positions survive", async () => {
  const f = await reportFixture();
  try {
    const upload = await readyFile(f, "synthetic original");
    const fileId = upload.session.fileId;
    const row = f.db.sqlite
      .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
      .get(fileId) as { revision: number; coverage_snapshot_id: string };
    const ids: string[] = [];
    for (let ordinal = 0; ordinal < 2; ordinal++) {
      const id = crypto.randomUUID(),
        entity = crypto.randomUUID();
      ids.push(entity);
      const value = {
        id: entity,
        text: `synthetic observation ${ordinal}`,
        position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      };
      const encrypted = await f.core.encrypt(
        "v2_file_observations",
        id,
        f.actor.ownerId,
        row.revision,
        value,
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
          ordinal,
          encrypted,
          row.coverage_snapshot_id,
        );
    }
    const review = createFileReviewService(f.core, () => f.actor.now);
    const before = await review.read(f.actor.ownerId, f.workspaceId, fileId);
    let saved = await review.start(
      f.actor.ownerId,
      f.workspaceId,
      fileId,
      before.workspaceRevision,
      crypto.randomUUID(),
      {
        expectedRevision: before.file.revision,
        edits: [
          { observationId: ids[0], text: "synthetic corrected observation", included: true },
          { observationId: ids[1], text: "synthetic excluded observation", included: false },
        ],
      },
    );
    for (let i = 0; saved.status !== "ready" && i < 20; i++)
      saved = await review.advance(f.actor.ownerId, f.workspaceId, fileId, saved.reviewId);
    expect(saved.status).toBe("ready");
    const reopened = await review.read(f.actor.ownerId, f.workspaceId, fileId);
    expect(reopened.observations[1]?.value.included).toBe(false);
    const context = await readWorkspaceContext(
      f.core,
      f.actor,
      f.workspaceId,
      message(f, "Please organize the selected synthetic material", [fileId]),
    );
    expect(context.materials.some((m) => m.text === "synthetic corrected observation")).toBe(true);
    const leaked = context.materials.some((m) => m.text === "synthetic excluded observation");
    expect(leaked).toBe(false);
    expect(context.materials[0]?.reference.position).toEqual({
      kind: "document",
      page: 1,
      paragraph: 1,
      table: null,
    });
    expect(context.materials[0]?.coverage).toMatchObject({
      userEdited: true,
      observationCertainty: "uncertain",
    });
    expect(() =>
      assertWorkspaceFacts(context, [
        {
          id: "excluded_fact",
          text: "synthetic excluded observation",
          attribution: "user_material",
          certainty: "uncertain",
          significance: "neutral",
          userEdited: false,
          conflictingFactIds: [],
          references: [
            {
              kind: "user_material",
              fileId,
              fileRevision: reopened.file.revision,
              position: { kind: "document", page: 1, paragraph: 2, table: null },
            },
          ],
        },
      ]),
    ).toThrow(WorkspaceOutputPolicyError);
    let allExcluded = await review.start(
      f.actor.ownerId,
      f.workspaceId,
      fileId,
      reopened.workspaceRevision,
      crypto.randomUUID(),
      {
        expectedRevision: reopened.file.revision,
        edits: [
          { observationId: ids[0], text: "synthetic corrected observation", included: false },
        ],
      },
    );
    for (let i = 0; allExcluded.status !== "ready" && i < 20; i++)
      allExcluded = await review.advance(
        f.actor.ownerId,
        f.workspaceId,
        fileId,
        allExcluded.reviewId,
      );
    expect(allExcluded.status).toBe("ready");
    const emptyContext = await readWorkspaceContext(
      f.core,
      f.actor,
      f.workspaceId,
      message(f, "Check selected material", [fileId]),
    );
    expect(emptyContext.materials).toEqual([]);
    expect(emptyContext.contextCoverage?.materialsPartial).toBe(true);
  } finally {
    f.db.close();
  }
});

const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
const dateCases = [
  ["2025", "2025-05-17", "day", null, "unknown"],
  ["2025년에 거래가 있었고 월과 일은 모릅니다.", "2025-05-17", "day", "2025-01-01", "year"],
  ["거래 날짜는 아직 모릅니다.", "2025-05-17", "day", null, "unknown"],
  ["2025년 5월에 거래했습니다.", "2025-05-17", "day", "2025-05-01", "month"],
  ["2025년 5월 17일에 거래했습니다.", "2025-05-17", "day", "2025-05-17", "day"],
  ["거래일은 2025-05-17입니다.", "2025-05-17", "day", "2025-05-17", "day"],
  ["거래일은 2025. 5. 17. 입니다.", "2025-05-17", "day", "2025-05-17", "day"],
  ["거래일은 2025/5/17입니다.", "2025-05-17", "day", "2025-05-17", "day"],
  ["거래 시기는 2025-05입니다.", "2025-05-17", "day", "2025-05-01", "month"],
  ["2025년 5월 17일에 거래했습니다.", "2026-05-17", "day", null, "unknown"],
  ["2025년 5월 17일에 거래했습니다.", "2025-06-17", "day", "2025-01-01", "year"],
  ["2025년 5월 17일에 거래했습니다.", "2025-05-18", "day", "2025-05-01", "month"],
  ["거래 금액은 2025원입니다.", "2025-05-17", "day", null, "unknown"],
  ["거래일은 2025년 2월 29일이라고 잘못 적었습니다.", "2025-02-28", "day", null, "unknown"],
  ["거래일은 2024년 2월 29일입니다.", "2024-02-29", "day", "2024-02-29", "day"],
  ["2025년 5월 17일에 거래했습니다.", "2025-01-01", "year", "2025-01-01", "year"],
  ["2025년 5월 17일에 거래했습니다.", null, "unknown", null, "unknown"],
] as const;

test.each(dateCases)(
  "v2 model/audit preserves source date precision: %s",
  async (text, date, precision, expectedDate, expectedPrecision) => {
    const f = await reportFixture();
    try {
      const latest = message(f, text);
      const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
      const ref = {
        kind: "user_message" as const,
        messageId: latest.id,
        workspaceRevision: latest.workspaceRevision,
      };
      const draft = {
        text: "합성 사건의 타임라인을 정리했어요.",
        references: [ref],
        warnings: [],
        facts: [],
        actions: [],
        parties: [],
        requestedSources: [],
        timeline: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            date,
            datePrecision: precision,
            event: "거래가 있었음",
            certainty: "reported",
            references: [ref],
            factIds: [],
            userEdited: false,
          },
        ],
      };
      const audits: unknown[] = [];
      const gateway = {
        call: async (phase: string, input: unknown) => {
          if (phase === "workspace_audit") {
            audits.push(input);
            return approved;
          }
          return draft;
        },
      } as unknown as Parameters<typeof createWorkspacePipeline>[0];
      const pipeline = createWorkspacePipeline(gateway, {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
      });
      const accepted = await pipeline.chat(context, crypto.randomUUID());
      expect(accepted.timeline[0]).toMatchObject({
        date: expectedDate,
        datePrecision: expectedPrecision,
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        phase: "workspace_chat",
        draft: { timeline: [{ date: expectedDate, datePrecision: expectedPrecision }] },
      });
      expect(accepted.warnings).toHaveLength(
        date === expectedDate && precision === expectedPrecision ? 0 : 1,
      );
    } finally {
      f.db.close();
    }
  },
);

test.each([true, false])(
  "current user correction supplies date evidence; AI organization does not (%s)",
  async (userEdited) => {
    const f = await reportFixture();
    try {
      const latest = message(f, "기존 사실을 정리해주세요.");
      const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
      const ref = {
        kind: "user_message" as const,
        messageId: latest.id,
        workspaceRevision: latest.workspaceRevision,
      };
      const fact: V2Fact = {
        id: "dated_fact",
        text: "거래일은 2026년 3월 12일입니다.",
        attribution: userEdited ? "user_statement" : "ai_organization",
        certainty: userEdited ? "reported" : "uncertain",
        significance: "neutral",
        userEdited,
        references: [ref],
        conflictingFactIds: [],
      };
      context.facts = [fact];
      const reply = {
        text: "기존 사실을 확인했어요.",
        references: [ref],
        warnings: [],
        facts: [],
        actions: [],
        parties: [],
        requestedSources: [],
        timeline: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            date: "2026-03-12",
            datePrecision: "day",
            event: "거래가 있었음",
            certainty: "reported",
            references: [ref],
            factIds: [fact.id],
            userEdited: false,
          },
        ],
      };
      const gateway = {
        call: async (phase: string) => (phase === "workspace_audit" ? approved : reply),
      } as unknown as Parameters<typeof createWorkspacePipeline>[0];
      const result = await createWorkspacePipeline(gateway, {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
      }).chat(context, crypto.randomUUID());
      expect(result.timeline[0]).toMatchObject(
        userEdited
          ? { date: "2026-03-12", datePrecision: "day" }
          : { date: null, datePrecision: "unknown" },
      );
    } finally {
      f.db.close();
    }
  },
);

test.each(["2025년에 거래했고 월과 일은 모릅니다.", "거래 날짜를 모릅니다."])(
  "v2 execution publishes bounded date warnings once and reconnect preserves them: %s",
  async (text) => {
    const f = await reportFixture();
    try {
      const jobs = createV2JobsRepository(f.core),
        jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID();
      const input = { text, selectedFileIds: [], expectedRevision: f.rev() };
      expect(
        await jobs.admitWorkspace(
          { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
          { operationId, key: crypto.randomUUID(), requestHash: "a".repeat(64) },
          jobId,
          "chat_response",
          { id: crypto.randomUUID(), request: input },
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
          authorize: (owner) => hasCustomerWorkspaceAccess(f.core, owner),
          pipeline: async () =>
            createWorkspacePipeline(
              {
                call: async (phase, raw) => {
                  if (phase === "workspace_audit") return approved;
                  const context =
                    raw as import("../src/server/modules/workspace/pipeline").WorkspaceContext;
                  const latest = context.latestMessage;
                  if (!latest) throw new Error("Missing synthetic user message");
                  const ref = {
                    kind: "user_message",
                    messageId: latest.id,
                    workspaceRevision: latest.workspaceRevision,
                  };
                  return {
                    text: "거래에 관한 진술을 정리했어요.",
                    references: [ref],
                    warnings: Array.from({ length: 20 }, (_, i) => `합성 경고 ${i}`),
                    facts: [],
                    actions: [],
                    parties: [],
                    requestedSources: [],
                    timeline: [
                      {
                        id: crypto.randomUUID(),
                        revision: 1,
                        date: "2025-05-17",
                        datePrecision: "day",
                        event: "거래가 있었다는 진술",
                        certainty: "reported",
                        references: [ref],
                        factIds: [],
                        userEdited: false,
                      },
                    ],
                  };
                },
              },
              { reserve: async () => true, invocation: () => crypto.randomUUID() },
            ),
        });
      expect((await run()).status).toBe("completed");
      const repository = () => createV2WorkspaceRepository(f.core.binding, f.core.cipher);
      const timeline = await repository().timeline(f.actor, f.workspaceId);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject(
        text.includes("2025년")
          ? { date: "2025-01-01", datePrecision: "year" }
          : { date: null, datePrecision: "unknown" },
      );
      const messages = await repository().messages(f.actor, f.workspaceId);
      const assistant = messages.find((m) => m.role === "assistant");
      expect(assistant?.role).toBe("assistant");
      if (assistant?.role !== "assistant") throw new Error("Missing synthetic response");
      expect(assistant.warnings).toHaveLength(20);
      expect(assistant.warnings.at(-1)).toContain("날짜 미확인");
      expect((await run()).status).toBe("completed");
      expect(await repository().timeline(f.actor, f.workspaceId)).toEqual(timeline);
      expect(await repository().messages(f.actor, f.workspaceId)).toEqual(messages);
    } finally {
      f.db.close();
    }
  },
);

test.each(["user_statement", "ai_organization"] as const)(
  "new fact-only timeline dates require validated source attribution: %s",
  async (attribution) => {
    const f = await reportFixture();
    try {
      const latest = message(f, "거래일은 2026년 3월 12일입니다.");
      const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
      const ref = {
        kind: "user_message" as const,
        messageId: latest.id,
        workspaceRevision: latest.workspaceRevision,
      };
      const fact: V2Fact = {
        id: "new_dated_fact",
        text: latest.text,
        attribution,
        certainty: attribution === "user_statement" ? "reported" : "uncertain",
        significance: "neutral",
        userEdited: false,
        references: [ref],
        conflictingFactIds: [],
      };
      const reply = {
        text: "추가 사실을 정리했어요.",
        references: [ref],
        warnings: [],
        facts: [fact],
        actions: [],
        parties: [],
        requestedSources: [],
        timeline: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            date: "2026-03-12",
            datePrecision: "day",
            event: "거래가 있었음",
            certainty: "reported",
            references: [],
            factIds: [fact.id],
            userEdited: false,
          },
        ],
      };
      const gateway = {
        call: async (phase: string) => (phase === "workspace_audit" ? approved : reply),
      } as unknown as Parameters<typeof createWorkspacePipeline>[0];
      const result = await createWorkspacePipeline(gateway, {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
      }).chat(context, crypto.randomUUID());
      expect(result.timeline[0]).toMatchObject(
        attribution === "user_statement"
          ? { date: "2026-03-12", datePrecision: "day" }
          : { date: null, datePrecision: "unknown" },
      );
    } finally {
      f.db.close();
    }
  },
);

test.each(["2025-05-17", "2026-03-12"])(
  "confirmed correction cannot regain the superseded source date: %s",
  async (candidate) => {
    const f = await reportFixture();
    try {
      const latest = message(f, "거래일은 2025년 5월 17일입니다.");
      const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
      const ref = {
        kind: "user_message" as const,
        messageId: latest.id,
        workspaceRevision: latest.workspaceRevision,
      };
      const corrected: V2Fact = {
        id: "corrected_date",
        text: "거래일은 2026년 3월 12일입니다.",
        attribution: "user_statement",
        certainty: "reported",
        significance: "neutral",
        userEdited: true,
        references: [ref],
        conflictingFactIds: [],
      };
      context.facts = [corrected];
      const reply = {
        text: "교정한 사실을 정리했어요.",
        references: [ref],
        warnings: [],
        facts: [],
        actions: [],
        parties: [],
        requestedSources: [],
        timeline: [
          {
            id: crypto.randomUUID(),
            revision: 1,
            date: candidate,
            datePrecision: "day",
            event: "거래가 있었음",
            certainty: "reported",
            references: [ref],
            factIds: [corrected.id],
            userEdited: false,
          },
        ],
      };
      const gateway = {
        call: async (phase: string) => (phase === "workspace_audit" ? approved : reply),
      } as unknown as Parameters<typeof createWorkspacePipeline>[0];
      const result = await createWorkspacePipeline(gateway, {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
      }).chat(context, crypto.randomUUID());
      expect(result.timeline[0]).toMatchObject(
        candidate === "2026-03-12"
          ? { date: candidate, datePrecision: "day" }
          : { date: null, datePrecision: "unknown" },
      );
    } finally {
      f.db.close();
    }
  },
);

test("date normalization preserves the official-source failure warning at the warning limit", async () => {
  const f = await reportFixture();
  try {
    const latest = message(f, "거래 날짜를 모릅니다.");
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
    context.sourceStatus = "unavailable";
    const ref = {
      kind: "user_message" as const,
      messageId: latest.id,
      workspaceRevision: latest.workspaceRevision,
    };
    const reply = {
      text: "확인할 내용을 정리했어요.",
      references: [ref],
      warnings: Array.from({ length: 20 }, (_, i) => `합성 경고 ${i}`),
      facts: [],
      actions: [],
      parties: [],
      requestedSources: [],
      timeline: [
        {
          id: crypto.randomUUID(),
          revision: 1,
          date: "2025-05-17",
          datePrecision: "day",
          event: "거래가 있었음",
          certainty: "reported",
          references: [ref],
          factIds: [],
          userEdited: false,
        },
      ],
    };
    const gateway = {
      call: async (phase: string) => (phase === "workspace_audit" ? approved : reply),
    } as unknown as Parameters<typeof createWorkspacePipeline>[0];
    const result = await createWorkspacePipeline(gateway, {
      reserve: async () => true,
      invocation: () => crypto.randomUUID(),
    }).chat(context, crypto.randomUUID());
    expect(result.timeline[0]).toMatchObject({ date: null, datePrecision: "unknown" });
    expect(result.warnings).toHaveLength(20);
    expect(result.warnings.some((w) => w.includes("공식 자료를 확인하지 못해"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("날짜 미확인"))).toBe(true);
  } finally {
    f.db.close();
  }
});
