import { expect, spyOn, test } from "bun:test";
import type { V2Action, V2AssistantMessage } from "../src/contracts/v2";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import {
  createWorkspacePublicationDiagnostics,
  safeWorkspacePublicationFailure,
  type WorkspacePublicationFailure,
} from "../src/server/workspace-publication-diagnostics";
import { reportFixture } from "./helpers/report-fixture";

type Fixture = Awaited<ReturnType<typeof reportFixture>>;
const refusal = "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.";
function action(): V2Action {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "organize_materials",
    title: "자료 정리",
    instructions: "자료를 날짜순으로 정리합니다.",
    caution: "원본을 보관합니다.",
    status: "todo",
    factIds: [],
    references: [],
  };
}
function draft() {
  return {
    text: refusal,
    references: [],
    warnings: [],
    facts: [],
    parties: [],
    actions: [],
    timeline: [],
    requestedSources: [],
  };
}
async function admit(f: Fixture) {
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  expect(
    await jobs.admitWorkspace(
      guard(),
      {
        operationId,
        key: crypto.randomUUID(),
        requestHash: "d".repeat(64),
      },
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          text: "이 합성 사건에서 소송 전략을 알려 주세요.",
          selectedFileIds: [],
          expectedRevision: f.rev(),
        },
      },
    ),
  ).toBe(true);
  const runtime = f.db.sqlite
    .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
    .get(jobId) as { runtime_instance_id: string };
  const message: V2AssistantMessage = {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId,
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "assistant",
    safety: "validated",
    text: refusal,
    references: [],
    citations: [],
    warnings: [],
  };
  const input = { message, facts: [], parties: [], actions: [], timeline: [] };
  return { jobs, jobId, operationId, guard, input, runtime: runtime.runtime_instance_id };
}
async function execute(f: Fixture, admitted: Awaited<ReturnType<typeof admit>>, reply: unknown) {
  return executeWorkspace(
    f.core,
    {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      workspaceRevision: f.rev(),
      jobId: admitted.jobId,
    },
    admitted.runtime,
    {
      clock: () => f.actor.now,
      authorize: async () => true,
      pipeline: async () =>
        createWorkspacePipeline(
          {
            call: async (phase) =>
              phase === "workspace_audit"
                ? {
                    pass: true,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  }
                : reply,
          } as Parameters<typeof createWorkspacePipeline>[0],
          {
            reserve: async () => true,
            invocation: () => crypto.randomUUID(),
          },
        ),
    },
  );
}

test("canonical refusal still publishes and does not invent a publication failure", async () => {
  const f = await reportFixture();
  const outcome = await execute(f, await admit(f), draft());
  expect(outcome.status).toBe("completed");
  expect(outcome).not.toHaveProperty("publicationFailure");
  const messages = await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
    f.actor,
    f.workspaceId,
  );
  expect(messages.find((m) => m.role === "assistant")?.text).toBe(refusal);
});

test("duplicate action IDs rejected after a passing audit produce only a finite receipt", async () => {
  const f = await reportFixture(),
    a = action(),
    admitted = await admit(f);
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await execute(f, admitted, { ...draft(), actions: [a, a] });
    expect(result).toMatchObject({
      status: "failed",
      publicationFailure: {
        stage: "entity_ids",
        reason: "duplicate_action_id",
      },
    });
    if (result.status !== "failed") throw new Error("Expected synthetic publication failure");
    expect(JSON.stringify(result.publicationFailure)).not.toContain(a.id);
    expect(JSON.stringify(result.publicationFailure)).not.toContain(refusal);
    expect(await admitted.jobs.find(f.actor, admitted.jobId)).toMatchObject({
      status: "failed",
      failure: "INTERNAL_ERROR",
    });
    expect(
      (
        await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
          f.actor,
          f.workspaceId,
        )
      ).filter((m) => m.role === "assistant"),
    ).toHaveLength(0);
  } finally {
    output.mockRestore();
  }
});

test("existing summary party collision retains SNAPSHOT_INVALID and distinguishes the merge check", async () => {
  const f = await reportFixture(),
    party = { id: crypto.randomUUID(), label: "보관자", role: "자료 보관" };
  expect((await execute(f, await admit(f), { ...draft(), parties: [party] })).status).toBe(
    "completed",
  );
  const workspace = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const intake = await workspace.readIntake(f.actor, f.workspaceId);
  if (!intake?.summary) throw new Error("Missing synthetic summary");
  expect(
    await workspace.confirmSummary(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        expectedRevision: intake.revision,
        summaryRevision: intake.summary.revision,
      },
    ),
  ).toBe(true);
  const admitted = await admit(f),
    acquired = await admitted.jobs.acquire(
      f.actor,
      admitted.jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
  if (!acquired) throw new Error("Missing synthetic lease");
  const failures: WorkspacePublicationFailure[] = [];
  await expect(
    createV2WorkspaceResponseRepository(f.core).commit(
      admitted.guard(),
      acquired.lease,
      { ...admitted.input, parties: [party] },
      (value) => failures.push(value),
    ),
  ).rejects.toMatchObject({ code: "SNAPSHOT_INVALID" });
  expect(failures).toEqual([{ stage: "summary_copy", reason: "duplicate_party_id" }]);
  expect((await workspace.readIntake(f.actor, f.workspaceId))?.summary).toEqual(intake.summary);
});

test("final CAS loss keeps false and publishes no message while its diagnostic sink may throw", async () => {
  const f = await reportFixture(),
    admitted = await admit(f);
  const acquired = await admitted.jobs.acquire(
    f.actor,
    admitted.jobId,
    crypto.randomUUID(),
    "2026-10-06T00:04:00.000Z",
  );
  if (!acquired) throw new Error("Missing synthetic lease");
  const failures: WorkspacePublicationFailure[] = [];
  const core = {
    ...f.core,
    encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
      const encrypted = await f.core.encrypt(...args);
      if (args[0] === "v2_messages")
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspaceId);
      return encrypted;
    },
  };
  expect(
    await createV2WorkspaceResponseRepository(core).commit(
      admitted.guard(),
      acquired.lease,
      admitted.input,
      (value) => {
        failures.push(value);
        throw new Error("private observer data");
      },
    ),
  ).toBe(false);
  expect(failures).toEqual([{ stage: "commit", reason: "claim_not_acquired" }]);
  expect(
    (
      await createV2WorkspaceRepository(f.core.binding, f.core.cipher).messages(
        f.actor,
        f.workspaceId,
      )
    ).filter((m) => m.role === "assistant"),
  ).toHaveLength(0);
  expect(await admitted.jobs.find(f.actor, admitted.jobId)).toMatchObject({ status: "running" });
});

test("publication observation does not add database operations and preserves safe dependency errors", async () => {
  const measurements: number[] = [];
  for (const observe of [false, true]) {
    const f = await reportFixture(),
      admitted = await admit(f);
    const acquired = await admitted.jobs.acquire(
      f.actor,
      admitted.jobId,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!acquired) throw new Error("Missing synthetic lease");
    const failures: WorkspacePublicationFailure[] = [],
      before = f.db.queryCount;
    const core = {
      ...f.core,
      encrypt: async () => {
        throw new Error("private-sql private-owner private-token private-draft");
      },
    };
    await expect(
      createV2WorkspaceResponseRepository(core).commit(
        admitted.guard(),
        acquired.lease,
        admitted.input,
        observe ? (value) => failures.push(value) : undefined,
      ),
    ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED", message: "DB_OPERATION_FAILED" });
    measurements.push(f.db.queryCount - before);
    expect(failures).toEqual(
      observe ? [{ stage: "message_encryption", reason: "dependency_exception" }] : [],
    );
    expect(JSON.stringify(failures)).not.toContain("private");
  }
  expect(measurements[0]).toBe(measurements[1]);
});

test("publication receipts reject extra data and arbitrary stage/reason values", async () => {
  const valid = { stage: "commit", reason: "claim_not_acquired" } as const;
  expect(safeWorkspacePublicationFailure(valid)).toEqual(valid);
  for (const invalid of [
    null,
    "private",
    { ...valid, id: "private" },
    { ...valid, sql: "private" },
    { ...valid, cause: "private" },
    { ...valid, stage: "private" },
    { ...valid, reason: "private" },
  ])
    expect(safeWorkspacePublicationFailure(invalid)).toBeUndefined();
  const thrown = new Error("private-exception"),
    failures: WorkspacePublicationFailure[] = [];
  const diagnostics = createWorkspacePublicationDiagnostics((value) => failures.push(value));
  diagnostics.at("references");
  await expect(
    diagnostics.run(async () => {
      throw thrown;
    }),
  ).rejects.toBe(thrown);
  expect(failures).toEqual([{ stage: "references", reason: "dependency_exception" }]);
});
