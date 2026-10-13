import { expect, test } from "bun:test";
import { type V2Fact, v2FactSchema } from "../src/contracts/v2";
import { utf8Bytes } from "../src/server/db/v2-core";
import { referencesAuthorized } from "../src/server/db/v2-workspace";
import { executeWorkspace, summaryFactPages } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";

test("summary publication keeps every fact while using bounded pages and no empty reference reads", async () => {
  const f = await customerWorkspaceFixture();
  try {
    for (let round = 0; round < 2; round++) {
      await runCustomerJob(f, "intake_questions");
      const intake = await f.service.intake(f.owner.userId, f.workspace.id);
      if (!intake) throw new Error("Missing synthetic intake");
      await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: intake.revision,
        answers: intake.batches
          .at(-1)
          ?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
      });
    }
    const w = await f.service.find(f.owner.userId, f.workspace.id);
    const jobId = crypto.randomUUID();
    expect(
      await f.jobs.admitWorkspace(
        {
          ownerId: f.owner.userId,
          now: f.now,
          workspaceId: w.id,
          expectedRevision: w.workspaceRevision,
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
        jobId,
        "intake_summary",
      ),
    ).toBe(true);
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    let publishing = false;
    const reads: string[] = [];
    f.db.binding.prepare = (sql) => {
      if (publishing && sql.startsWith("SELECT")) reads.push(sql);
      return prepare(sql);
    };
    const result = await executeWorkspace(
      f.core,
      {
        ownerId: f.owner.userId,
        workspaceId: w.id,
        workspaceRevision: w.workspaceRevision + 1,
        jobId,
      },
      `${jobId}-1`,
      {
        clock: () => f.now,
        authorize: async () => true,
        pipeline: async () =>
          createWorkspacePipeline(
            {
              call: async (phase, raw) => {
                if (phase === "workspace_audit") {
                  publishing = true;
                  return {
                    pass: true,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  };
                }
                const { intake } = raw as { intake: { narrative: string; revision: number } };
                return {
                  overview: "합성 사건 요약입니다.",
                  facts: Array.from({ length: 9 }, (_, index) => ({
                    id: `fact-${index}`,
                    text: intake.narrative,
                    attribution: "user_statement",
                    certainty: "reported",
                    significance: "neutral",
                    userEdited: false,
                    references: [{ kind: "intake_narrative", intakeRevision: intake.revision }],
                    conflictingFactIds: [],
                  })),
                  parties: [],
                  unknowns: [],
                  notices: ["합성 검증입니다."],
                };
              },
            },
            { reserve: async () => true, invocation: () => crypto.randomUUID() },
          ),
      },
    );
    publishing = false;
    expect(result.status).toBe("completed");
    const saved = await f.repository.readIntake({ ownerId: f.owner.userId, now: f.now }, w.id);
    expect(saved?.summary?.facts.map((fact) => fact.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `fact-${i}`),
    );
    expect(
      reads.filter((sql) => sql.includes("purpose='summary' AND target_id=? AND state='staging'")),
    ).toHaveLength(3);
    expect(
      reads.some((sql) => /FROM v2_(answers|messages|files|citation_bindings)\b/.test(sql)),
    ).toBe(false);
  } finally {
    f.db.close();
  }
});

test("fact pages honor UTF-8 byte bounds as well as item count", () => {
  const fact = v2FactSchema.parse({
    id: "large-fact",
    text: "😀".repeat(2000),
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    userEdited: false,
    references: Array.from({ length: 100 }, () => ({
      kind: "user_message",
      messageId: "m".repeat(128),
      workspaceRevision: 1,
    })),
    conflictingFactIds: [],
  });
  const facts = Array.from({ length: 9 }, (_, i) => ({ ...fact, id: `large-${i}` }));
  const pages = [...summaryFactPages(facts)];
  expect(pages.flat()).toEqual(facts);
  expect(pages.some((page) => page.length < 4 && page !== pages.at(-1))).toBe(true);
  for (const page of pages) {
    expect(page.length).toBeLessThanOrEqual(4);
    expect(utf8Bytes(JSON.stringify({ facts: page, parties: [] }))).toBeLessThanOrEqual(98304);
  }
});

test("skipping absent reference kinds never authorizes an unowned workspace or missing referenced row", async () => {
  const f = await customerWorkspaceFixture();
  try {
    const g = {
      ownerId: f.owner.userId,
      now: f.now,
      workspaceId: f.workspace.id,
      expectedRevision: f.workspace.workspaceRevision,
    };
    expect(await referencesAuthorized(f.core, { ...g, ownerId: crypto.randomUUID() }, [])).toBe(
      false,
    );
    const refs: V2Fact["references"] = [
      { kind: "intake_answer", questionId: "missing-answer", intakeRevision: 1 },
      { kind: "user_message", messageId: "missing-message", workspaceRevision: 1 },
      { kind: "official_source", citationId: "missing-citation" },
    ];
    for (const ref of refs) expect(await referencesAuthorized(f.core, g, [ref])).toBe(false);
    expect(
      await referencesAuthorized(f.core, g, [{ kind: "intake_narrative", intakeRevision: 99 }]),
    ).toBe(false);
  } finally {
    f.db.close();
  }
});
