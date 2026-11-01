import { expect, test } from "bun:test";
import { z } from "zod";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

test("queued-job metadata capability cannot publish domain state, bump revisions or run SQL hooks", async () => {
  const f = await customerWorkspaceFixture();
  try {
    f.db.sqlite
      .query("UPDATE v2_workspaces SET status='active',confirmed_summary_revision=1 WHERE id=?")
      .run(f.workspace.id);
    const jobId = crypto.randomUUID();
    expect(
      await f.jobs.admitWorkspace(
        {
          ownerId: f.owner.userId,
          now: f.now,
          workspaceId: f.workspace.id,
          expectedRevision: f.workspace.workspaceRevision,
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
        jobId,
        "chat_response",
        {
          id: crypto.randomUUID(),
          request: {
            text: "자료를 검토해 주세요.",
            expectedRevision: f.workspace.workspaceRevision,
            selectedFileIds: [],
          },
        },
      ),
    ).toBe(true);
    const g = {
      ownerId: f.owner.userId,
      now: f.now,
      workspaceId: f.workspace.id,
      expectedRevision: f.workspace.workspaceRevision + 1,
    };
    const repo = createV2ReworkRepository(f.core, { clock: () => f.now });
    const input = {
      kind: "checkpoint" as const,
      entityId: jobId,
      expectedVersion: 0,
      schema: z.object({ reportRequested: z.boolean() }),
      value: { reportRequested: true },
      metadataJobId: jobId,
    };
    expect(await repo.write(g, input)).not.toBeNull();
    expect((await f.repository.findWorkspace(g, f.workspace.id))?.workspaceRevision).toBe(
      g.expectedRevision,
    );
    await expect(repo.write(g, { ...input, kind: "analysis" })).rejects.toMatchObject({
      code: "REPOSITORY_INPUT_INVALID",
    });
    await expect(repo.write(g, { ...input, bumpWorkspace: true })).rejects.toMatchObject({
      code: "REPOSITORY_INPUT_INVALID",
    });
    await expect(repo.write(g, { ...input, statements: () => [] })).rejects.toMatchObject({
      code: "REPOSITORY_INPUT_INVALID",
    });
    expect(
      await repo.write(g, {
        ...input,
        entityId: crypto.randomUUID(),
        metadataJobId: crypto.randomUUID(),
      }),
    ).toBeNull();
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
    expect(await repo.write(g, { ...input, expectedVersion: 1 })).toBeNull();
  } finally {
    f.db.close();
  }
});
