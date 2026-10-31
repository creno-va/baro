import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import type { V2Action, V2AssistantMessage } from "../src/contracts/v2";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createV2WorkspaceResponseRepository } from "../src/server/db/v2-workspace-response";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { copySyntheticD1 } from "./helpers/native-d1";
import { readyFile, reportFixture } from "./helpers/report-fixture";

const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
const quote = "거래 상태: 송금 완료. 금액: 300만원. 거래일: 2026년 10월 1일.";
async function fixture() {
  const f = await reportFixture();
  const uploaded = await readyFile(f, "synthetic receipt"),
    fileId = uploaded.session.fileId;
  const file = f.db.sqlite
    .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
    .get(fileId) as { revision: number; coverage_snapshot_id: string };
  const observationId = crypto.randomUUID();
  const observation = {
    id: crypto.randomUUID(),
    text: quote,
    position: { kind: "document" as const, page: 1, paragraph: 1, table: null },
    certainty: "observed",
    userEdited: false,
    included: true,
  };
  const payload = await f.core.encrypt(
    "v2_file_observations",
    observationId,
    f.actor.ownerId,
    file.revision,
    observation,
  );
  f.db.sqlite
    .query(
      "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,0,?,?)",
    )
    .run(
      observationId,
      observation.id,
      fileId,
      file.revision,
      file.revision,
      payload,
      file.coverage_snapshot_id,
    );
  const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  const action: V2Action = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "fact_check",
    title: "300만원 송금 내역 확인",
    instructions: "2026년 10월 1일 송금이 완료되었는지 이체확인증에서 확인하세요.",
    caution: "예약이나 처리 대기는 완료로 보지 마세요.",
    status: "todo",
    factIds: [],
    references: [],
  };
  expect(await repo.writeAction(guard(), action, null)).toBe(true);
  const other = { ...action, id: crypto.randomUUID(), title: "상대방에게 보낸 요구서 도달 확인" };
  expect(await repo.writeAction(guard(), other, null)).toBe(true);
  const jobs = createV2JobsRepository(f.core),
    jobId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  expect(
    await jobs.admitWorkspace(
      guard(),
      { operationId, key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          text: "이 자료를 반영해 주세요.",
          selectedFileIds: [fileId],
          expectedRevision: f.rev(),
        },
      },
    ),
  ).toBe(true);
  const latest = await repo.userMessage(f.actor, f.workspaceId, operationId);
  if (!latest) throw new Error("Synthetic message missing");
  const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, latest);
  const reference = {
    kind: "user_material" as const,
    fileId,
    fileRevision: file.revision,
    position: observation.position,
  };
  const completion = { actionId: action.id, expectedRevision: 1, reference, quote };
  const draft = {
    text: "자료에서 송금 완료 상태를 확인해 해당 준비 항목을 완료로 표시했어요.",
    references: [],
    warnings: [],
    facts: [],
    parties: [],
    actions: [],
    timeline: [],
    requestedSources: [],
    actionCompletions: [completion],
  };
  return {
    ...f,
    repo,
    guard,
    jobs,
    jobId,
    operationId,
    context,
    reference,
    completion,
    draft,
    action,
    other,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
test("bounded AI context prioritizes pending actions beyond closed items without changing list pagination", async () => {
  const f = await fixture();
  for (let ordinal = 0; ordinal < 8; ordinal++) {
    const id = crypto.randomUUID();
    const action = { ...f.action, id: `000-closed-${ordinal}`, status: "done" as const };
    const payload = await f.core.encrypt("v2_actions", id, f.actor.ownerId, 1, action);
    f.db.sqlite
      .query(
        "INSERT INTO v2_actions(id,entity_id,workspace_id,revision,kind,status,encrypted_payload) VALUES(?,?,?,1,?,'done',?)",
      )
      .run(id, action.id, f.workspaceId, action.kind, payload);
  }
  const context = await readWorkspaceContext(
    f.core,
    f.actor,
    f.workspaceId,
    f.context.latestMessage ?? undefined,
  );
  expect(context.existingActions).toHaveLength(8);
  expect(
    context.existingActions
      ?.filter((action) => action.status === "todo")
      .map((action) => action.id)
      .sort(),
  ).toEqual([f.action.id, f.other.id].sort());
  expect(context.contextCoverage?.preparationPartial).toBe(true);
  expect(
    (await f.repo.actions(f.actor, f.workspaceId, undefined, 8)).map((action) => action.id),
  ).toEqual(Array.from({ length: 8 }, (_, ordinal) => `000-closed-${ordinal}`));
});
function pipeline(draft: unknown, audit = approved) {
  return createWorkspacePipeline(
    { call: async (phase) => (phase === "workspace_audit" ? audit : draft) } as Parameters<
      typeof createWorkspacePipeline
    >[0],
    { reserve: async () => true, invocation: () => crypto.randomUUID() },
  );
}

test("attachment response completes only the evidenced existing action atomically and users can undo it", async () => {
  const f = await fixture();
  const runtime = f.db.sqlite
    .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
    .get(f.jobId) as { runtime_instance_id: string };
  const result = await executeWorkspace(
    f.core,
    {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      workspaceRevision: f.rev(),
      jobId: f.jobId,
    },
    runtime.runtime_instance_id,
    {
      clock: () => f.actor.now,
      authorize: async () => true,
      pipeline: async () => pipeline(f.draft),
    },
  );
  expect(result.status).toBe("completed");
  const saved = (await f.repo.actions(f.actor, f.workspaceId, undefined, 8)).find(
    (action) => action.id === f.action.id,
  );
  expect(saved).toEqual({ ...f.action, revision: 2, status: "done", references: [f.reference] });
  expect(
    (await f.repo.actions(f.actor, f.workspaceId, undefined, 8)).find(
      (action) => action.id === f.other.id,
    ),
  ).toEqual(f.other);
  expect(
    (await f.repo.messages(f.actor, f.workspaceId)).find((message) => message.role === "assistant")
      ?.references,
  ).toContainEqual(f.reference);
  if (!saved) throw new Error("Synthetic completed action missing");
  expect(await f.repo.writeAction(f.guard(), { ...saved, revision: 3, status: "todo" }, 2)).toBe(
    true,
  );
});

test("fabricated quotes, source positions, revisions, IDs and non-material claims cannot check a task", async () => {
  const f = await fixture();
  for (const completion of [
    { ...f.completion, quote: "요구서가 상대방에게 도달했습니다." },
    {
      ...f.completion,
      reference: { ...f.reference, position: { ...f.reference.position, page: 2 } },
    },
    { ...f.completion, reference: { ...f.reference, fileRevision: f.reference.fileRevision + 1 } },
    { ...f.completion, actionId: "other-case-action" },
    { ...f.completion, expectedRevision: 2 },
    {
      ...f.completion,
      reference: {
        kind: "user_message",
        messageId: f.context.latestMessage?.id,
        workspaceRevision: f.rev(),
      },
    },
  ])
    await expect(
      pipeline({ ...f.draft, actionCompletions: [completion] }).chat(f.context, "synthetic-proof"),
    ).rejects.toThrow();
  await expect(
    pipeline({ ...f.draft, actionCompletions: [f.completion, f.completion] }).chat(
      f.context,
      "synthetic-duplicate",
    ),
  ).rejects.toThrow();
  for (const status of ["done", "skipped"] as const)
    await expect(
      pipeline(f.draft).chat(
        {
          ...f.context,
          existingActions: (f.context.existingActions ?? []).map((action) => ({
            ...action,
            status,
          })),
        },
        "synthetic-state",
      ),
    ).rejects.toThrow();
  expect(
    (await f.repo.actions(f.actor, f.workspaceId, undefined, 8)).every(
      (action) => action.status === "todo",
    ),
  ).toBe(true);
});

test("uncertain or manually rewritten observations are not automatic completion proof; semantic audit rejects pending transfers", async () => {
  const f = await fixture();
  for (const coverage of [
    { observationCertainty: "uncertain", userEdited: false },
    { observationCertainty: "observed", userEdited: true },
    {},
  ])
    await expect(
      pipeline(f.draft).chat(
        {
          ...f.context,
          materials: f.context.materials.map((material) => ({ ...material, coverage })),
        },
        "synthetic-uncertain",
      ),
    ).rejects.toThrow();
  const pending = "거래 상태: 예약 접수. 송금은 아직 실행되지 않았습니다.";
  const badDraft = { ...f.draft, actionCompletions: [{ ...f.completion, quote: pending }] };
  await expect(
    pipeline(badDraft, { ...approved, pass: false }).chat(
      {
        ...f.context,
        materials: f.context.materials.map((material) => ({ ...material, text: pending })),
      },
      "synthetic-pending",
    ),
  ).rejects.toThrow("POLICY_REJECTED");
  const empty = await pipeline({
    ...f.draft,
    text: "이 자료만으로 수행 여부를 확인할 수 없어요.",
    actionCompletions: [],
  }).chat(f.context, "synthetic-no-change");
  expect(empty.actionCompletions).toEqual([]);
});

async function commit(f: Fixture, mutate?: () => Promise<void>) {
  const acquired = await f.jobs.acquire(
    f.actor,
    f.jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 240000).toISOString(),
  );
  if (!acquired) throw new Error("Synthetic lease missing");
  const message: V2AssistantMessage = {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId: f.operationId,
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "assistant",
    safety: "validated",
    text: f.draft.text,
    references: [f.reference],
    citations: [],
    warnings: [],
  };
  return createV2WorkspaceResponseRepository({
    ...f.core,
    encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
      const result = await f.core.encrypt(...args);
      if (args[0] === "v2_messages") await mutate?.();
      return result;
    },
  }).commit(f.guard(), acquired.lease, {
    message,
    facts: [],
    parties: [],
    actions: [],
    timeline: [],
    actionCompletions: [f.completion],
  });
}
test("native Workers D1 publishes the completion and message in the same fenced batch", async () => {
  const f = await fixture();
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("synthetic"); } }',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    await copySyntheticD1(db, f.db.sqlite);
    const core = createV2Core(db, f.core.cipher);
    expect(await commit({ ...f, core, jobs: createV2JobsRepository(core) })).toBe(true);
    const repo = createV2WorkspaceRepository(db, f.core.cipher);
    expect(
      (await repo.actions(f.actor, f.workspaceId, undefined, 8)).find(
        (action) => action.id === f.action.id,
      ),
    ).toEqual({ ...f.action, revision: 2, status: "done", references: [f.reference] });
    expect(
      (await repo.messages(f.actor, f.workspaceId)).filter(
        (message) => message.role === "assistant",
      ),
    ).toHaveLength(1);
  } finally {
    await mf.dispose();
  }
}, 30000);
for (const race of ["manual_status", "file_deleted", "lease_expired"] as const)
  test(`publication preserves user changes and rejects obsolete proof: ${race}`, async () => {
    const f = await fixture(),
      revision = f.rev();
    expect(
      await commit(f, async () => {
        if (race === "manual_status") {
          const row = f.db.sqlite
            .query("SELECT id FROM v2_actions WHERE entity_id=?")
            .get(f.action.id) as { id: string };
          const payload = await f.core.encrypt("v2_actions", row.id, f.actor.ownerId, 2, {
            ...f.action,
            revision: 2,
            status: "skipped",
          });
          f.db.sqlite
            .query(
              "UPDATE v2_actions SET revision=2,status='skipped',encrypted_payload=? WHERE id=?",
            )
            .run(payload, row.id);
        } else if (race === "file_deleted")
          f.db.sqlite
            .query("UPDATE v2_files SET state='deleting' WHERE id=?")
            .run(f.reference.fileId);
        else
          f.db.sqlite
            .query("UPDATE v2_jobs SET lease_until=? WHERE id=?")
            .run("2000-01-01T00:00:00.000Z", f.jobId);
      }),
    ).toBe(false);
    expect(f.rev()).toBe(revision);
    const actions = await f.repo.actions(f.actor, f.workspaceId, undefined, 8);
    expect(actions.find((action) => action.id === f.action.id)?.status).toBe(
      race === "manual_status" ? "skipped" : "todo",
    );
    expect(
      (await f.repo.messages(f.actor, f.workspaceId)).filter(
        (message) => message.role === "assistant",
      ),
    ).toHaveLength(0);
  });
