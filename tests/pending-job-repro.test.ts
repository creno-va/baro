/** Local reproductions and recovery regressions; no external provider success is claimed.
 * SQLite, encrypted records, admission, leases and read/retry paths are real.
 * Existing explicitly offline fixtures provide R2 and no-active-control admission.
 */
import type { SQLQueryBindings } from "bun:sqlite";
import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2Core } from "../src/server/db/v2-core";
import { recordExecutionTransport } from "../src/server/db/v2-execution-runtime";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { usageReceiptSchema } from "../src/server/db/v2-paid-contracts";
import { runtimeDigest } from "../src/server/db/v2-paid-runtime";
import { createFileProcessingDispatcher } from "../src/server/modules/file-processing/dispatch";
import { createFileProcessingExecution } from "../src/server/modules/file-processing/execution";
import { nativeJobId } from "../src/server/modules/file-processing/native-identity";
import { ProcessingError } from "../src/server/modules/file-processing/protocol";
import { createFileRetry } from "../src/server/modules/file-processing/retry";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { createFilesService } from "../src/server/modules/files/service";
import { createMediaGateway } from "../src/server/modules/llm-gateway/transcription";
import { createWorkspaceDispatcher } from "../src/server/modules/workspace/dispatch";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { reconcileStoppedJobs } from "../src/server/runtime/job-recovery";
import { stoppedJobRetryPredicate } from "../src/server/runtime/job-recovery-transport";
import { hasCustomerWorkspaceAccess } from "../src/server/runtime/workspace";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";
import { fixture, r2, uploaded } from "./helpers/file-processing-fixture";
import { copySyntheticD1 } from "./helpers/native-d1";

function workflowBinding() {
  const instances = new Set<string>();
  let reads = 0;
  let status = "queued";
  return {
    binding: {
      async get(id: string) {
        reads++;
        if (!instances.has(id)) throw new Error("Synthetic absent instance");
        return { id, status: async () => ({ status }) };
      },
      async create({ id }: { id: string }) {
        instances.add(id);
        return { id, status: async () => ({ status }) };
      },
    },
    reads: () => reads,
    stop: () => {
      status = "errored";
    },
  };
}

test("terminal Workflow recovery repairs dispatched file lease expiry and permits a fresh user retry", async () => {
  const f = await fixture();
  const u = await uploaded(f);
  const jobs = createV2JobsRepository(f.core);
  const jobId = nativeJobId("file");
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: u.manifest.contentHash,
        },
        quotas: [],
      },
    ),
  ).toBe(true);
  let time = Date.parse(f.actor.now);
  const clock = () => new Date(time).toISOString();
  const platform = workflowBinding();
  const dispatcher = createFileProcessingDispatcher(f.core, { binding: platform.binding, clock });
  expect((await dispatcher.dispatch()).dispatched).toBe(1);
  const noIO = async (): Promise<never> => {
    throw new Error("No external work expected");
  };
  const costs: ProcessingCosts = { before: noIO, after: noIO };
  const execution = createFileProcessingExecution(
    f.core,
    {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      fileId: u.session.fileId,
      fileRevision: 2,
      jobId,
    },
    {
      environment: "preview",
      files: f.service,
      bucket: f.bucket.port,
      processor: createProcessorTransport({ costs, fetch: noIO, stop: noIO }),
      media: createMediaGateway(
        { AI_GATEWAY_ID: "synthetic", AI: { run: noIO } } as unknown as Env,
        {
          costs,
          waitUntil: () => {},
        },
      ),
      costs,
      clock,
      instanceId: `${jobId}-1`,
    },
  );
  expect((await execution.initialize()).status).toBe("running");
  time += 300001;
  f.setNow(clock());
  expect(await execution.fail(new ProcessingError("JOB_TIMEOUT"))).toEqual({ status: "stopped" });
  platform.stop();
  const lookups = platform.reads();
  expect(await dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
  expect(platform.reads()).toBe(lookups);
  const listed = await f.service.list(f.actor.ownerId, f.workspaceId);
  expect(listed[0]).toMatchObject({ status: "queued", currentJobId: jobId });
  expect("canRetry" in (listed[0] ?? {})).toBe(false);
  const retry = createFileRetry(f.core, { APP_ENV: "preview" } as Env, { clock });
  expect(
    (
      await retry(f.actor.ownerId, f.workspaceId, u.session.fileId, {
        expectedRevision: f.rev(),
        fileRevision: 2,
      })
    )?.status,
  ).toBe("queued");
  expect(f.db.sqlite.query("SELECT status,attempts FROM v2_jobs WHERE id=?").get(jobId)).toEqual({
    status: "running",
    attempts: 1,
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_outbox WHERE job_id=?").get(jobId)).toEqual({
    state: "dispatched",
  });
  const revisionBeforeRecovery = f.rev();
  expect(await reconcileStoppedJobs(f.core, { files: platform.binding, clock })).toEqual({
    inspected: 1,
    recovered: 1,
  });
  expect(f.rev()).toBe(revisionBeforeRecovery);
  expect((await f.service.list(f.actor.ownerId, f.workspaceId))[0]).toMatchObject({
    status: "failed",
    currentJobId: null,
    canRetry: true,
  });
  expect(await reconcileStoppedJobs(f.core, { files: platform.binding, clock })).toEqual({
    inspected: 0,
    recovered: 0,
  });
  const recoveredRetry = createFileRetry(f.core, { APP_ENV: "preview" } as Env, {
    clock,
    testOnlyUnmeteredStorage: true,
  });
  expect(
    (
      await recoveredRetry(f.actor.ownerId, f.workspaceId, u.session.fileId, {
        expectedRevision: f.rev(),
        fileRevision: 2,
      })
    )?.status,
  ).toBe("queued");
  expect(
    f.db.sqlite.query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?").get(jobId),
  ).toEqual({ runtime_instance_id: `${jobId}-2` });
  expect(await execution.fail(new ProcessingError("JOB_TIMEOUT"))).toEqual({ status: "stopped" });
  expect(f.db.sqlite.query("SELECT status FROM v2_jobs WHERE id=?").get(jobId)).toEqual({
    status: "queued",
  });
});

async function activeCustomer() {
  const f = await customerWorkspaceFixture();
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake?.batches[0]) throw new Error("Synthetic questions absent");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: intake.batches[0].questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  await runCustomerJob(f, "intake_summary");
  await confirmCustomerSummary(f);
  return f;
}

test.each(["lease-expiry", "file-reservation", "file-admission"] as const)(
  "terminal Workflow recovery repairs chat %s without publishing stale output",
  async (kind) => {
    const f = await activeCustomer();
    try {
      let time = Date.parse(f.now);
      const clock = () => new Date(time).toISOString();
      const rev = () =>
        (
          f.db.sqlite
            .query("SELECT revision FROM v2_workspaces WHERE id=?")
            .get(f.workspace.id) as { revision: number }
        ).revision;
      const fileService = createFilesService(f.core, {
        environment: "preview",
        bucket: r2().port,
        clock,
        testOnlyUnmeteredStorage: true,
        probe: async ({ open, byteLength }) => {
          await new Response(open()).arrayBuffer();
          return { category: "document", format: "txt", byteLength, pageCount: 1 };
        },
      });
      const file =
        kind === "file-admission"
          ? await uploaded({
              service: fileService,
              actor: { ownerId: f.owner.userId, now: f.now },
              workspaceId: f.workspace.id as ReturnType<typeof crypto.randomUUID>,
              rev,
            })
          : null;
      const before = await f.service.find(f.owner.userId, f.workspace.id);
      const jobId = crypto.randomUUID();
      expect(
        await f.jobs.admitWorkspace(
          {
            ownerId: f.owner.userId,
            now: clock(),
            workspaceId: f.workspace.id,
            expectedRevision: before.workspaceRevision,
          },
          {
            operationId: crypto.randomUUID(),
            key: crypto.randomUUID(),
            requestHash: "a".repeat(64),
          },
          jobId,
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: before.workspaceRevision,
              text: "합성 사건의 자료 준비 항목을 정리해주세요.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      const params = {
        ownerId: f.owner.userId,
        workspaceId: f.workspace.id,
        workspaceRevision: before.workspaceRevision + 1,
        jobId,
      };
      const platform = workflowBinding();
      const dispatcher = createWorkspaceDispatcher(f.core, { binding: platform.binding, clock });
      expect((await dispatcher.dispatch()).dispatched).toBe(1);
      let injected = false;
      const result = await executeWorkspace(f.core, params, `${jobId}-1`, {
        clock,
        authorize: (ownerId) => hasCustomerWorkspaceAccess(f.core, ownerId),
        pipeline: async () => {
          injected = true;
          if (kind === "lease-expiry") time += 300001;
          if (kind === "file-reservation") {
            await fileService.reserve(f.owner.userId, f.workspace.id, rev(), crypto.randomUUID(), {
              name: "합성 동시 업로드.txt",
              byteLength: 32,
              mediaType: "text/plain",
              autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
            });
          }
          if (kind === "file-admission" && file) {
            expect(
              await f.jobs.admitFile(
                {
                  ownerId: f.owner.userId,
                  now: clock(),
                  workspaceId: f.workspace.id,
                  expectedRevision: rev(),
                },
                {
                  fileId: file.session.fileId,
                  fileRevision: 2,
                  jobId: nativeJobId("file"),
                  admission: {
                    operationId: crypto.randomUUID(),
                    key: crypto.randomUUID(),
                    requestHash: file.manifest.contentHash,
                  },
                  quotas: [],
                },
              ),
            ).toBe(true);
          }
          // executeWorkspace's own next renewal must reject the expired or
          // revision-stale binding. Do not manufacture an execution error here.
          return createWorkspacePipeline(
            {
              call: async () => {
                throw new Error("Stale work must stop before any model call");
              },
            },
            { reserve: async () => true, invocation: () => crypto.randomUUID() },
          );
        },
      });
      expect(injected).toBe(true);
      expect(result.status).toBe("failed");
      const w = await f.service.find(f.owner.userId, f.workspace.id);
      expect(w.currentJobId).toBe(jobId);
      if (kind !== "lease-expiry") expect(w.workspaceRevision).toBe(params.workspaceRevision + 1);
      const job = await f.service.latestJob(f.owner.userId, f.workspace.id);
      expect(job).toMatchObject({
        id: jobId,
        status: "running",
        failure: null,
        retryable: false,
        attempts: 1,
      });
      platform.stop();
      const lookups = platform.reads();
      expect(await dispatcher.dispatch()).toEqual({ dispatched: 0, pending: 0, available: true });
      expect(platform.reads()).toBe(lookups);
      expect(
        (
          await f.service.retry(f.owner.userId, f.workspace.id, jobId, {
            expectedRevision: w.workspaceRevision,
          })
        ).status,
      ).toBe("queued");
      expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.status).toBe("running");
      expect(
        await f.jobs.admitWorkspace(
          {
            ownerId: f.owner.userId,
            now: clock(),
            workspaceId: f.workspace.id,
            expectedRevision: w.workspaceRevision,
          },
          {
            operationId: crypto.randomUUID(),
            key: crypto.randomUUID(),
            requestHash: "b".repeat(64),
          },
          crypto.randomUUID(),
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: w.workspaceRevision,
              text: "합성 후속 질문입니다.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(false);
      const messagesBefore = f.db.sqlite.query("SELECT * FROM v2_messages").all();
      const quotasBefore = f.db.sqlite
        .query("SELECT * FROM v2_quota_reservations WHERE state='consumed'")
        .all();
      const usageBefore = f.db.sqlite
        .query("SELECT responses_used,responses_reserved FROM v2_daily_usage WHERE owner_id=?")
        .get(f.owner.userId) as { responses_used: number; responses_reserved: number };
      expect(await reconcileStoppedJobs(f.core, { workspaces: platform.binding, clock })).toEqual({
        inspected: 1,
        recovered: 1,
      });
      const recovered = await f.service.find(f.owner.userId, f.workspace.id);
      expect(recovered.currentJobId).toBeNull();
      expect(
        f.db.sqlite.query("SELECT * FROM v2_quota_reservations WHERE state='consumed'").all(),
      ).toEqual(quotasBefore);
      expect(
        f.db.sqlite
          .query("SELECT responses_used,responses_reserved FROM v2_daily_usage WHERE owner_id=?")
          .get(f.owner.userId),
      ).toEqual({
        responses_used: usageBefore.responses_used,
        responses_reserved: usageBefore.responses_reserved - 1,
      });
      expect(recovered.workspaceRevision).toBe(w.workspaceRevision + 1);
      expect(await f.service.latestJob(f.owner.userId, f.workspace.id)).toMatchObject({
        status: "failed",
        failure: "JOB_TIMEOUT",
        retryable: true,
        attempts: 1,
      });
      expect(f.db.sqlite.query("SELECT * FROM v2_messages").all()).toEqual(messagesBefore);
      expect(
        await f.jobs.retry(
          {
            ownerId: f.owner.userId,
            now: clock(),
            workspaceId: f.workspace.id,
            expectedRevision: recovered.workspaceRevision,
          },
          jobId,
        ),
      ).toBe(true);
      expect(
        f.db.sqlite.query("SELECT runtime_instance_id,status FROM v2_jobs WHERE id=?").get(jobId),
      ).toEqual({ runtime_instance_id: `${jobId}-2`, status: "queued" });
    } finally {
      f.db.close();
    }
  },
);

async function stoppedFile(acquire = true) {
  const f = await fixture();
  const u = await uploaded(f);
  const jobs = createV2JobsRepository(f.core);
  const jobId = nativeJobId("file");
  const operationId = crypto.randomUUID();
  expect(
    await jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId,
        admission: { operationId, key: crypto.randomUUID(), requestHash: u.manifest.contentHash },
        quotas: [],
      },
    ),
  ).toBe(true);
  let time = Date.parse(f.actor.now);
  const clock = () => new Date(time).toISOString();
  const platform = workflowBinding();
  expect(
    (await createFileProcessingDispatcher(f.core, { binding: platform.binding, clock }).dispatch())
      .dispatched,
  ).toBe(1);
  const acquired = acquire
    ? await jobs.acquire(f.actor, jobId, crypto.randomUUID(), new Date(time + 300000).toISOString())
    : null;
  if (acquire) expect(acquired).not.toBeNull();
  time += 300001;
  f.setNow(clock());
  platform.stop();
  const snapshot = () => ({
    job: f.db.sqlite.query("SELECT * FROM v2_jobs WHERE id=?").get(jobId),
    file: f.db.sqlite.query("SELECT * FROM v2_files WHERE id=?").get(u.session.fileId),
    operation: f.db.sqlite.query("SELECT * FROM v2_operations WHERE id=?").get(operationId),
    outbox: f.db.sqlite.query("SELECT * FROM v2_outbox WHERE job_id=?").all(jobId),
    usage: f.db.sqlite.query("SELECT * FROM v2_daily_usage").all(),
    quota: f.db.sqlite.query("SELECT * FROM v2_quota_reservations").all(),
  });
  const recover = (files = platform.binding, limit = 8) =>
    reconcileStoppedJobs(f.core, { files, clock, limit });
  return {
    ...f,
    u,
    jobs,
    jobId,
    operationId,
    acquired,
    platform,
    clock,
    recover,
    snapshot,
    advance: () => {
      time += 60000;
      f.setNow(clock());
    },
  };
}

test.each([
  "queued",
  "running",
  "waiting",
  "paused",
  "unknown",
  "waitingForPause",
  "throw",
  "wrong-id",
])("recovery preserves every record for platform %s without terminal evidence", async (status) => {
  const f = await stoppedFile();
  const before = f.snapshot();
  const files = {
    ...f.platform.binding,
    get: async (id: string) => {
      if (status === "throw") throw new Error("Synthetic platform failure");
      return {
        id: status === "wrong-id" ? crypto.randomUUID() : id,
        status: async () => ({ status }),
      };
    },
  };
  expect(await f.recover(files)).toEqual({ inspected: 1, recovered: 0 });
  expect(f.snapshot()).toEqual(before);
});

test.each(["complete", "errored", "terminated"])(
  "exact %s workflow is recoverable",
  async (status) => {
    const f = await stoppedFile();
    expect(
      await f.recover({
        ...f.platform.binding,
        get: async (id) => ({ id, status: async () => ({ status }) }),
      }),
    ).toEqual({ inspected: 1, recovered: 1 });
    expect(f.snapshot().job).toMatchObject({
      status: "failed",
      retryable: 1,
      failure_code: "JOB_TIMEOUT",
    });
  },
);

test.each([
  "new-lease",
  "runtime",
  "updated-at",
  "workspace-revision",
  "file-current-job",
  "file-revision",
  "account-deleted",
  "workspace-deleted",
  "file-deleted",
  "workspace-owner",
])("terminal lookup cannot overwrite concurrent %s", async (change) => {
  const f = await stoppedFile();
  let after: ReturnType<typeof f.snapshot> | undefined;
  const files = {
    ...f.platform.binding,
    get: async (id: string) => ({
      id,
      status: async () => {
        if (change === "new-lease")
          expect(
            await f.jobs.acquire(
              { ...f.actor, now: f.clock() },
              f.jobId,
              crypto.randomUUID(),
              new Date(Date.parse(f.clock()) + 300000).toISOString(),
            ),
          ).not.toBeNull();
        if (change === "runtime")
          f.db.sqlite
            .query("UPDATE v2_jobs SET runtime_instance_id=? WHERE id=?")
            .run(`${f.jobId}-2`, f.jobId);
        if (change === "updated-at")
          f.db.sqlite.query("UPDATE v2_jobs SET updated_at=? WHERE id=?").run(f.clock(), f.jobId);
        if (change === "workspace-revision")
          f.db.sqlite
            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
            .run(f.workspaceId);
        if (change === "file-current-job")
          f.db.sqlite
            .query("UPDATE v2_files SET current_job_id=NULL WHERE id=?")
            .run(f.u.session.fileId);
        if (change === "file-revision")
          f.db.sqlite
            .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
            .run(f.u.session.fileId);
        if (change.endsWith("-deleted")) {
          const kind = change.startsWith("account-")
            ? "account"
            : change.startsWith("workspace-")
              ? "workspace"
              : "file";
          const target =
            kind === "account"
              ? f.actor.ownerId
              : kind === "workspace"
                ? f.workspaceId
                : f.u.session.fileId;
          f.db.sqlite
            .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
            .run(kind, target, f.clock());
        }
        if (change === "workspace-owner") {
          // Reassignment is never a production operation; adversarial local DB
          // fixture ensures the owner join is checked again after platform IO.
          const other = await import("./helpers/session").then(({ seedTestSession }) =>
            seedTestSession(f.db),
          );
          f.db.sqlite
            .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
            .run(other.userId, f.workspaceId);
        }
        after = f.snapshot();
        return { status: "errored" };
      },
    }),
  };
  expect(await f.recover(files)).toEqual({ inspected: 1, recovered: 0 });
  if (!after) throw new Error("Synthetic concurrent mutation did not run");
  expect(f.snapshot()).toEqual(after);
});

test("a terminal pre-initialize queued run consumes its runtime ordinal once and retries with a distinct instance", async () => {
  const f = await stoppedFile(false);
  expect(f.snapshot().job).toMatchObject({
    status: "queued",
    lease_token: null,
    lease_until: null,
    attempts: 0,
  });
  expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
  expect(f.snapshot().job).toMatchObject({ status: "failed", attempts: 1 });
  expect(
    await f.jobs.retry(
      { ...f.actor, now: f.clock(), workspaceId: f.workspaceId, expectedRevision: f.rev() },
      f.jobId,
    ),
  ).toBe(true);
  expect(f.snapshot().job).toMatchObject({
    status: "queued",
    runtime_instance_id: `${f.jobId}-2`,
    attempts: 1,
  });
  expect(
    await f.jobs.acquire(
      { ...f.actor, now: f.clock() },
      f.jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.clock()) + 300000).toISOString(),
    ),
  ).not.toBeNull();
  expect(f.snapshot().job).toMatchObject({ status: "running", attempts: 2 });
  expect(await f.recover()).toEqual({ inspected: 0, recovered: 0 });
});

test("the expired old writer cannot fail or checkpoint the recovered retry's new lease", async () => {
  const f = await stoppedFile();
  if (!f.acquired) throw new Error("Synthetic lease missing");
  expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
  expect(
    await f.jobs.retry(
      { ...f.actor, now: f.clock(), workspaceId: f.workspaceId, expectedRevision: f.rev() },
      f.jobId,
    ),
  ).toBe(true);
  expect(
    await f.jobs.acquire(
      { ...f.actor, now: f.clock() },
      f.jobId,
      crypto.randomUUID(),
      new Date(Date.parse(f.clock()) + 300000).toISOString(),
    ),
  ).not.toBeNull();
  const before = f.snapshot();
  expect(
    await f.jobs.fail({ ...f.actor, now: f.clock() }, f.acquired.lease, "JOB_TIMEOUT", true),
  ).toBe(false);
  expect(
    await f.jobs.checkpoint({ ...f.actor, now: f.clock() }, f.acquired.lease, {
      id: crypto.randomUUID(),
      revision: 1,
      phase: "validating",
      progress: 90,
      opaqueIds: [],
    }),
  ).toBe(false);
  expect(f.snapshot()).toEqual(before);
});

test("recovering an expired file leaves another live chat's pointer and revision untouched", async () => {
  const f = await stoppedFile();
  const chatId = crypto.randomUUID();
  const rev = f.rev();
  expect(
    await f.jobs.admitWorkspace(
      { ...f.actor, now: f.clock(), workspaceId: f.workspaceId, expectedRevision: rev },
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "c".repeat(64) },
      chatId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: { expectedRevision: rev, text: "합성 별도 질문", selectedFileIds: [] },
      },
    ),
  ).toBe(true);
  const before = f.db.sqlite.query("SELECT * FROM v2_workspaces WHERE id=?").get(f.workspaceId);
  expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
  expect(f.db.sqlite.query("SELECT * FROM v2_workspaces WHERE id=?").get(f.workspaceId)).toEqual(
    before,
  );
  expect(
    await f.jobs.acquire(
      { ...f.actor, now: f.clock() },
      chatId,
      crypto.randomUUID(),
      new Date(Date.parse(f.clock()) + 300000).toISOString(),
    ),
  ).not.toBeNull();
});

test("current consent still blocks a user's recovery retry", async () => {
  const f = await stoppedFile();
  await f.recover();
  const retry = createFileRetry(f.core, { APP_ENV: "preview" } as Env, {
    clock: f.clock,
    testOnlyUnmeteredStorage: true,
  });
  f.db.sqlite
    .query("UPDATE user_consents SET ai_notice_version='obsolete' WHERE user_id=?")
    .run(f.actor.ownerId);
  const before = f.snapshot();
  await expect(
    retry(f.actor.ownerId, f.workspaceId, f.u.session.fileId, {
      expectedRevision: f.rev(),
      fileRevision: 2,
    }),
  ).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
  expect(f.snapshot()).toEqual(before);
});

test("bounded scanning rotates past old unknown instances to later terminal work", async () => {
  const f = await stoppedFile();
  const u = await uploaded(f);
  const other = nativeJobId("file");
  expect(
    await f.jobs.admitFile(
      { ...f.actor, now: f.clock(), workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        fileId: u.session.fileId,
        fileRevision: 2,
        jobId: other,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: u.manifest.contentHash,
        },
        quotas: [],
      },
    ),
  ).toBe(true);
  expect(
    (
      await createFileProcessingDispatcher(f.core, {
        binding: f.platform.binding,
        clock: f.clock,
      }).dispatch()
    ).dispatched,
  ).toBe(1);
  for (let n = 0; n < 5; n++) f.advance();
  const calls = new Set<string>();
  const files = {
    ...f.platform.binding,
    get: async (id: string) => {
      calls.add(id);
      return { id, status: async () => ({ status: id === `${other}-1` ? "errored" : "running" }) };
    },
  };
  let recovered = 0;
  for (let n = 0; n < 2; n++) {
    recovered += (await f.recover(files, 1)).recovered;
    f.advance();
  }
  expect(recovered).toBe(1);
  expect(calls.has(`${other}-1`)).toBe(true);
  expect(f.snapshot().job).toMatchObject({ status: "running" });
});

type Stopped = Awaited<ReturnType<typeof stoppedFile>>;
function insertRow(f: Stopped, table: string, row: Record<string, SQLQueryBindings>) {
  const keys = Object.keys(row);
  f.db.sqlite
    .query(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key] ?? null));
}
function journalFixture(f: Stopped) {
  const principalId = (
    f.db.sqlite
      .query("SELECT id FROM v2_billing_principals WHERE owner_id=?")
      .get(f.actor.ownerId) as { id: string }
  ).id;
  const operation = f.snapshot().operation as { revision: number };
  const request = {
    attemptId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    quoteId: null,
    pricingProofId: null,
    fundingProofId: null,
    attempt: 1,
    service: "container",
    jobId: f.jobId,
    targetKind: "file",
    targetId: f.u.session.fileId,
    targetRevision: 2,
    plan: {
      operationId: f.operationId,
      operationRevision: operation.revision,
      requestHash: "a".repeat(64),
      invocationId: crypto.randomUUID(),
      maximumAttempts: 1,
      deadlineAt: f.clock(),
      quantities: [{ sku: "container_cpu_seconds", maximumQuantity: "300" }],
    },
  };
  return { principalId, request };
}
async function seedExecution(f: Stopped, state: "dispatched" | "unknown" | "final") {
  const { principalId, request: r } = journalFixture(f);
  insertRow(f, "v2_execution_admissions", {
    attempt_id: r.attemptId,
    plan_id: r.planId,
    principal_id: principalId,
    environment: "preview",
    kind: "job",
    operation_id: f.operationId,
    operation_revision: r.plan.operationRevision,
    request_hash: r.plan.requestHash,
    invocation_id: r.plan.invocationId,
    attempt: 1,
    service: r.service,
    job_id: f.jobId,
    runtime_instance_id: `${f.jobId}-1`,
    target_kind: r.targetKind,
    target_id: r.targetId,
    target_revision: 2,
    digest: await runtimeDigest(r),
    payload_json: JSON.stringify(r),
    evidence_hash: "a".repeat(64),
    verified_at: f.actor.now,
    deadline_at: f.clock(),
    created_at: f.actor.now,
  });
  const token = crypto.randomUUID();
  f.db.sqlite
    .query(
      "UPDATE v2_execution_admissions SET state='dispatched',lease_token=?,fencing=1,dispatch_token=?,dispatched_at=? WHERE attempt_id=?",
    )
    .run(f.acquired?.lease.token ?? crypto.randomUUID(), token, f.actor.now, r.attemptId);
  if (state !== "dispatched")
    expect(
      await recordExecutionTransport(f.core, {
        attemptId: r.attemptId,
        dispatchToken: token,
        observedAt: f.clock(),
        transport: state === "unknown" ? "unknown" : "response",
      }),
    ).toBe(true);
  return r;
}
function history(f: Stopped) {
  const tables = [
    "v2_execution_admissions",
    "v2_execution_cost_observations",
    "v2_runtime_usage",
    "v2_cost_attempts",
    "v2_paid_holds",
    "v2_cost_receipts",
    "v2_monthly_budget",
    "v2_physical_blob_bindings",
    "v2_physical_storage_capacity",
    "v2_storage_reservations",
    "v2_blobs",
  ];
  return tables.map((table) => f.db.sqlite.query(`SELECT * FROM ${table}`).all());
}

test.each(["dispatched", "unknown", "final"] as const)(
  "unpriced %s transport controls retry while every execution and physical record is preserved",
  async (state) => {
    const f = await stoppedFile();
    await seedExecution(f, state);
    expect(f.db.sqlite.query("SELECT * FROM v2_runtime_proofs").all()).toEqual([]);
    const before = history(f);
    expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
    expect(f.snapshot().job).toMatchObject({
      status: "failed",
      retryable: state === "final" ? 1 : 0,
    });
    expect(history(f)).toEqual(before);
    if (state !== "final") {
      expect(
        await f.jobs.retry(
          { ...f.actor, now: f.clock(), workspaceId: f.workspaceId, expectedRevision: f.rev() },
          f.jobId,
        ),
      ).toBe(false);
      expect(f.snapshot().outbox).toHaveLength(1);
    }
  },
);

async function seedLegacy(f: Stopped) {
  const { principalId, request } = journalFixture(f);
  const pricingId = crypto.randomUUID(),
    fundingId = crypto.randomUUID(),
    quoteId = crypto.randomUUID();
  for (const [id, kind] of [
    [pricingId, "pricing"],
    [fundingId, "funding"],
  ]) {
    if (!id || !kind) throw new Error("Synthetic identity missing");
    insertRow(f, "v2_runtime_proofs", {
      id,
      kind,
      environment: "preview",
      digest: "a".repeat(64),
      payload_json: JSON.stringify({ synthetic: true }),
      evidence_hash: "a".repeat(64),
      verification_method: "authenticated_console",
      verified_at: f.actor.now,
      valid_until: f.clock(),
    });
  }
  insertRow(f, "v2_monthly_budget", {
    month: "2026-10",
    allocation_version: 1,
    environment: "preview",
    limit_krw: 1000,
    ambiguous_krw: 123,
  });
  insertRow(f, "v2_cost_quotes", {
    id: quoteId,
    version: 1,
    reviewed_at: f.actor.now,
    valid_until: f.clock(),
    currency: "KRW",
    provider_pricing_version: pricingId,
    exchange_rate: 1000,
    safety_margin: 0,
    estimated_krw: 123,
  });
  insertRow(f, "v2_runtime_plans", {
    id: request.planId,
    operation_id: f.operationId,
    operation_revision: request.plan.operationRevision,
    request_hash: request.plan.requestHash,
    invocation_id: request.plan.invocationId,
    pricing_proof_id: pricingId,
    funding_proof_id: fundingId,
    job_id: f.jobId,
    target_kind: "file",
    target_id: request.targetId,
    target_revision: 2,
    digest: "a".repeat(64),
    payload_json: JSON.stringify(request),
    evidence_hash: "a".repeat(64),
    verified_at: f.actor.now,
    maximum_attempts: 1,
    reserved_krw: 123,
    deadline_at: f.clock(),
    created_at: f.actor.now,
  });
  insertRow(f, "v2_cost_attempts", {
    id: request.attemptId,
    principal_id: principalId,
    operation_id: f.operationId,
    invocation_id: request.plan.invocationId,
    attempt: 1,
    month: "2026-10",
    quote_id: quoteId,
    service: "container",
    state: "ambiguous",
    reserved_krw: 123,
    charged_krw: null,
    created_at: f.actor.now,
  });
  const token = crypto.randomUUID();
  insertRow(f, "v2_paid_holds", {
    attempt_id: request.attemptId,
    plan_id: request.planId,
    job_id: f.jobId,
    state: "unknown",
    lease_token: crypto.randomUUID(),
    fencing: 1,
    dispatch_token: token,
    dispatched_at: f.actor.now,
  });
  return { request, token };
}
async function legacyReceipt(
  f: Stopped,
  legacy: Awaited<ReturnType<typeof seedLegacy>>,
  extra: Record<string, unknown> = {},
  wrongDigest = false,
) {
  const receipt = usageReceiptSchema.parse({
    id: crypto.randomUUID(),
    attemptId: legacy.request.attemptId,
    invocationId: legacy.request.plan.invocationId,
    providerRequestId: null,
    dispatchToken: legacy.token,
    observedAt: f.actor.now,
    transport: "response",
    definitiveNoCharge: false,
    meteringComplete: false,
    quantities: [],
    chargedUsd: null,
    ...extra,
  });
  insertRow(f, "v2_runtime_usage", {
    id: receipt.id,
    attempt_id: legacy.request.attemptId,
    digest: wrongDigest ? "f".repeat(64) : await runtimeDigest(receipt),
    payload_json: JSON.stringify(receipt),
    evidence_hash: "a".repeat(64),
    observed_at: receipt.observedAt,
    outcome: "ambiguous",
    charged_krw: null,
  });
  return receipt;
}

test.each([
  "known",
  "unknown",
  "wrong-token",
  "wrong-invocation",
  "future",
  "wrong-digest",
  "missing",
])("historical %s receipt never converts unknown money to a charge or release", async (kind) => {
  const f = await stoppedFile();
  const legacy = await seedLegacy(f);
  if (kind !== "missing")
    await legacyReceipt(
      f,
      legacy,
      {
        ...(kind === "unknown" ? { transport: "unknown" } : {}),
        ...(kind === "wrong-token" ? { dispatchToken: crypto.randomUUID() } : {}),
        ...(kind === "wrong-invocation" ? { invocationId: crypto.randomUUID() } : {}),
        ...(kind === "future"
          ? { observedAt: new Date(Date.parse(f.clock()) + 1).toISOString() }
          : {}),
      },
      kind === "wrong-digest",
    );
  const before = history(f);
  expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
  expect(f.snapshot().job).toMatchObject({ status: "failed", retryable: kind === "known" ? 1 : 0 });
  expect(history(f)).toEqual(before);
});

test("a newer unknown legacy receipt invalidates the verified transport predicate before the write", async () => {
  const f = await stoppedFile();
  const legacy = await seedLegacy(f);
  await legacyReceipt(f, legacy);
  const proof = await stoppedJobRetryPredicate(f.core, f.operationId, f.clock());
  const canRetry = () =>
    f.core
      .statement(`SELECT CASE WHEN ${proof.sql} THEN 1 ELSE 0 END AS allowed`, proof.values)
      .first<number>("allowed");
  expect(await canRetry()).toBe(1);
  await legacyReceipt(f, legacy, { transport: "unknown", observedAt: f.clock() });
  expect(await canRetry()).toBe(0);
});

test("terminal Workflow does not stop a running physical writer or release held bytes", async () => {
  const f = await stoppedFile();
  const blobId = crypto.randomUUID(),
    reservationId = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,created_at) SELECT ?,id,?,?,?,'derived_report',100,? FROM v2_billing_principals WHERE owner_id=?",
    )
    .run(reservationId, f.operationId, blobId, blobId, f.actor.now, f.actor.ownerId);
  f.db.sqlite
    .query(
      "UPDATE v2_storage_usage SET reserved_bytes=reserved_bytes+100 WHERE principal_id=(SELECT id FROM v2_billing_principals WHERE owner_id=?)",
    )
    .run(f.actor.ownerId);
  const encrypted = await f.core.encrypt("v2_blobs", blobId, f.actor.ownerId, 1, {
    contentHash: "a".repeat(64),
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,object_key,logical_bytes,cipher_bytes,encrypted_payload,created_at) SELECT ?,id,?,'derivative','private',?,100,0,?,? FROM v2_billing_principals WHERE owner_id=?",
    )
    .run(blobId, reservationId, `private/${blobId}`, encrypted, f.actor.now, f.actor.ownerId);
  insertRow(f, "v2_physical_storage_capacity", { environment: "preview", capacity_bytes: 10000 });
  insertRow(f, "v2_physical_blob_bindings", {
    blob_id: blobId,
    environment: "preview",
    owner_id: f.actor.ownerId,
    object_key: `private/${blobId}`,
    maximum_cipher_bytes: 100,
    inventory_hash: "a".repeat(64),
    created_at: f.actor.now,
  });
  f.db.sqlite
    .query(
      "UPDATE v2_physical_blob_bindings SET writer_state='running',writer_token=?,expected_cipher_bytes=100 WHERE blob_id=?",
    )
    .run(crypto.randomUUID(), blobId);
  const before = history(f);
  expect(await f.recover()).toEqual({ inspected: 1, recovered: 1 });
  expect(f.snapshot().job).toMatchObject({ status: "failed", retryable: 0 });
  expect(history(f)).toEqual(before);
});

test("the actual workerd D1 parser and transactional batch recover a terminal job", async () => {
  const f = await stoppedFile();
  const legacy = await seedLegacy(f);
  await legacyReceipt(f, legacy);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic recovery")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    await copySyntheticD1(db, f.db.sqlite);
    const core = createV2Core(db, f.core.cipher, { applicationCostLimitsEnabled: false });
    expect(await reconcileStoppedJobs(core, { files: f.platform.binding, clock: f.clock })).toEqual(
      { inspected: 1, recovered: 1 },
    );
    expect(
      await db
        .prepare("SELECT status,retryable,failure_code FROM v2_jobs WHERE id=?")
        .bind(f.jobId)
        .first<{ status: string; retryable: number; failure_code: string }>(),
    ).toEqual({ status: "failed", retryable: 1, failure_code: "JOB_TIMEOUT" });
    expect(
      await db
        .prepare("SELECT state FROM v2_paid_holds WHERE attempt_id=?")
        .bind(legacy.request.attemptId)
        .first<string>("state"),
    ).toBe("unknown");
    expect(
      await db.prepare("SELECT count(*) AS count FROM v2_mutation_claims").first<number>("count"),
    ).toBe(0);
  } finally {
    await mf.dispose();
  }
}, 60000);
