import { expect, test } from "bun:test";
import { v2MessageSchema } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { researchRevisionBase } from "../src/server/db/v2-research-revision";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { storedMessageSchema } from "../src/server/modules/workspace/stored-message";
import { reportFixture } from "./helpers/report-fixture";

type Fixture = Awaited<ReturnType<typeof reportFixture>>;
async function turn(f: Fixture, change: "none" | "clear_unknowns" | "action" = "none") {
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    before = f.rev();
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  expect(
    await jobs.admitWorkspace(
      guard(),
      { operationId, key: crypto.randomUUID(), requestHash: "d".repeat(64) },
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          text: "고맙습니다. 지금 내용을 확인하고 있어요.",
          selectedFileIds: [],
          expectedRevision: before,
        },
      },
    ),
  ).toBe(true);
  const acquired = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 240000).toISOString(),
  );
  if (!acquired) throw new Error("Missing synthetic lease");
  expect(await researchRevisionBase(f.core, f.actor.ownerId, f.workspaceId, f.rev(), 1)).toBe(
    f.rev(),
  );
  const message = {
    schemaVersion: "2" as const,
    id: crypto.randomUUID(),
    operationId,
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "assistant" as const,
    safety: "validated" as const,
    text: "확인하신 뒤 필요한 자료가 있으면 알려 주세요.",
    references: [],
    citations: [],
    warnings: [],
  };
  expect(
    await createV2WorkspaceResponseRepository(f.core).commit(guard(), acquired.lease, {
      message,
      facts: [],
      parties: [],
      timeline: [],
      ...(change === "clear_unknowns" ? { unknowns: [] } : {}),
      actions:
        change === "action"
          ? [
              {
                id: crypto.randomUUID(),
                revision: 1,
                kind: "organize_materials",
                title: "자료 정리",
                instructions: "원본을 정리해 주세요.",
                caution: "원본을 보존하세요.",
                status: "todo",
                factIds: [],
                references: [],
              },
            ]
          : [],
    }),
  ).toBe(true);
  const row = f.db.sqlite
    .query("SELECT revision,encrypted_payload FROM v2_messages WHERE id=?")
    .get(message.id) as { revision: number; encrypted_payload: string };
  const stored = await f.core.decrypt(
    "v2_messages",
    message.id,
    f.actor.ownerId,
    row.revision,
    row.encrypted_payload,
    storedMessageSchema(),
  );
  if (stored.role !== "assistant") throw new Error("Expected stored assistant");
  return { before, message, row, stored };
}

test("actual neutral publication keeps the research basis across repeated turns and preserves strict installed-client messages", async () => {
  const f = await reportFixture();
  try {
    const first = await turn(f);
    expect(first.stored.unchangedResearch).toMatchObject({
      beforeWorkspaceRevision: first.before,
      summaryRevision: 1,
    });
    expect(await researchRevisionBase(f.core, f.actor.ownerId, f.workspaceId, f.rev(), 1)).toBe(
      first.before,
    );
    await turn(f);
    expect(await researchRevisionBase(f.core, f.actor.ownerId, f.workspaceId, f.rev(), 1)).toBe(
      first.before,
    );
    const messages = await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
      f.actor,
      f.workspaceId,
    );
    for (const message of messages) {
      expect(v2MessageSchema().safeParse(message).success).toBe(true);
      expect(message).not.toHaveProperty("unchangedResearch");
    }
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_jobs WHERE status='completed'").get(),
    ).toEqual({ n: 2 });
  } finally {
    f.db.close();
  }
});

for (const change of ["clear_unknowns", "action"] as const)
  test(`actual ${change} mutation remains a research boundary`, async () => {
    const f = await reportFixture();
    try {
      const saved = await turn(f, change);
      expect(saved.stored.unchangedResearch).toBeUndefined();
      expect(await researchRevisionBase(f.core, f.actor.ownerId, f.workspaceId, f.rev(), 1)).toBe(
        f.rev(),
      );
      if (change === "clear_unknowns")
        expect(
          f.db.sqlite
            .query("SELECT confirmed_summary_revision FROM v2_workspaces WHERE id=?")
            .get(f.workspaceId),
        ).toEqual({ confirmed_summary_revision: null });
      else
        expect(
          f.db.sqlite
            .query("SELECT count(*) n FROM v2_actions WHERE workspace_id=?")
            .get(f.workspaceId),
        ).toEqual({ n: 1 });
    } finally {
      f.db.close();
    }
  });

for (const alteration of [
  "legacy",
  "summary",
  "revision",
  "operation",
  "failed",
  "foreign_owner",
] as const)
  test(`an actual completed neutral turn cannot authenticate ${alteration} history`, async () => {
    const f = await reportFixture();
    try {
      const saved = await turn(f);
      const proof = saved.stored.unchangedResearch;
      if (!proof) throw new Error("Missing synthetic proof");
      const value = { ...saved.stored };
      if (alteration === "legacy") delete value.unchangedResearch;
      if (alteration === "summary") value.unchangedResearch = { ...proof, summaryRevision: 2 };
      if (alteration === "revision")
        value.unchangedResearch = {
          ...proof,
          beforeWorkspaceRevision: proof.beforeWorkspaceRevision + 1,
        };
      if (alteration === "operation") value.operationId = crypto.randomUUID();
      if (alteration === "failed")
        f.db.sqlite
          .query(
            "UPDATE v2_jobs SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE operation_id=?",
          )
          .run(saved.message.operationId);
      const payload = await f.core.encrypt(
        "v2_messages",
        saved.message.id,
        f.actor.ownerId,
        saved.row.revision,
        value,
      );
      f.db.sqlite
        .query("UPDATE v2_messages SET encrypted_payload=? WHERE id=?")
        .run(payload, saved.message.id);
      expect(
        await researchRevisionBase(
          f.core,
          alteration === "foreign_owner" ? crypto.randomUUID() : f.actor.ownerId,
          f.workspaceId,
          f.rev(),
          1,
        ),
      ).toBe(f.rev());
    } finally {
      f.db.close();
    }
  });
