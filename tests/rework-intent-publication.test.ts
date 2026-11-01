import { expect, test } from "bun:test";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReworkStateService } from "../src/server/modules/rework/state";
import { reportFixture } from "./helpers/report-fixture";

for (const intent of ["add_material", "prepare_report"] as const)
  test(`${intent}: an actual completed response projects its publication revision and never rebases an old intent`, async () => {
    const f = await reportFixture();
    try {
      const clock = () => f.actor.now;
      const context = createReworkCaseService(f.core, { clock });
      await context.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: f.rev(),
        casePurpose: "prepare_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      });
      const jobs = createV2JobsRepository(f.core),
        jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID();
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
              expectedRevision: f.rev(),
              text: "합성 자료와 리포트를 확인하고 싶습니다.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      const admissionRevision = f.rev();
      const acquired = await jobs.acquire(
        f.actor,
        jobId,
        crypto.randomUUID(),
        new Date(Date.parse(f.actor.now) + 240000).toISOString(),
      );
      if (!acquired) throw new Error("Missing synthetic lease");
      const id = crypto.randomUUID();
      expect(
        await createV2WorkspaceResponseRepository(f.core).commit(guard(), acquired.lease, {
          message: {
            schemaVersion: "2",
            id,
            operationId,
            workspaceRevision: admissionRevision,
            createdAt: f.actor.now,
            role: "assistant",
            safety: "validated",
            text: "확인한 내용으로 다음 작업을 이어갈 수 있어요.",
            references: [],
            citations: [],
            warnings: [],
          },
          facts: [],
          parties: [],
          actions: [],
          timeline: [],
          conversationIntent: intent,
        }),
      ).toBe(true);
      const state = createReworkStateService(f.core, { clock });
      const current = await state.get(f.actor.ownerId, f.workspaceId);
      expect(current.workspaceRevision).toBe(admissionRevision + 1);
      expect(current.intents).toEqual([
        {
          messageId: id,
          requestId: `intent-${id}`,
          intent,
          workspaceRevision: current.workspaceRevision,
        },
      ]);
      const legacy = await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
        f.actor,
        f.workspaceId,
      );
      expect(legacy.find((message) => message.id === id)?.workspaceRevision).toBe(
        admissionRevision,
      );
      await context.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: f.rev(),
        casePurpose: "respond_to_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      });
      const changed = await state.get(f.actor.ownerId, f.workspaceId);
      expect(changed.intents).toEqual(current.intents);
      expect(changed.intents[0]?.workspaceRevision).toBeLessThan(changed.workspaceRevision);
      // A completed-message DTO alone cannot authorize a failed/nonmatching job.
      f.db.sqlite
        .query("UPDATE v2_jobs SET status='failed',failure_code='MODEL_UNAVAILABLE' WHERE id=?")
        .run(jobId);
      expect((await state.get(f.actor.ownerId, f.workspaceId)).intents).toEqual([]);
    } finally {
      f.db.close();
    }
  });
