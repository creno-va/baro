import type { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import {
  V2_INTAKE_POLICY,
  v2ActionUpdateRequestSchema,
  v2AnswersForBatchSchema,
  v2AnswersRequestSchema,
  v2CreateCaseRequestSchema,
  v2IntakeAdvanceRequestSchema,
  v2MessageRequestSchema,
  v2SummaryConfirmationRequestSchema,
  v2SummaryEditRequestSchema,
  v2TimelineEditRequestSchema,
  v2WorkspaceStateRequestSchema,
} from "../../../contracts/v2";
import { createV2AccountingRepository } from "../../db/v2-accounting";
import type { Actor, V2Core } from "../../db/v2-core";
import { canRetryV2Job } from "../../db/v2-job-retry";
import { createV2JobsRepository } from "../../db/v2-jobs";
import type { MutationReceipt } from "../../db/v2-mutation-receipts";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import type { PreparedPaidHold } from "../../db/v2-paid-statements";
import { createV2SummaryEditsRepository } from "../../db/v2-summary-edits";
import { type Admission, createV2WorkspaceRepository } from "../../db/v2-workspace";
import { dependencyStep } from "../../dependency-diagnostics";

export class WorkspaceError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "STALE_REVISION"
      | "REVIEW_REQUIRED"
      | "USER_QUOTA_EXCEEDED"
      | "BUDGET_UNAVAILABLE"
      | "IDEMPOTENCY_CONFLICT",
  ) {
    super(code);
  }
}
export type WorkspaceJobInput = {
  ownerId: string;
  caseId: string;
  revision: number;
  operationRevision?: number;
  kind: "intake_questions" | "intake_summary" | "chat_response";
  jobId: string;
  admission: Admission;
  chat?: { id: string; request: z.infer<typeof v2MessageRequestSchema> };
  retryMessage?: import("../../../contracts/v2").V2UserMessage;
};
export type WorkspaceDependencies = {
  clock?: () => string;
  guideHosts?: readonly string[];
  /** Server-only gateway admission; a browser cannot supply a paid hold. */
  prepareJob?: (
    input: WorkspaceJobInput,
  ) => Promise<{ paid: PreparedPaidHold; actor: Actor } | null>;
  dispatch?: () => Promise<unknown>;
};

export function createWorkspaceService(core: V2Core, deps: WorkspaceDependencies = {}) {
  const workspace = createV2WorkspaceRepository(core.binding, core.cipher, deps.guideHosts);
  const accounting = createV2AccountingRepository(core);
  const jobs = createV2JobsRepository(core);
  const actor = (ownerId: string) => ({
    ownerId,
    now: (deps.clock ?? (() => new Date().toISOString()))(),
  });
  const find = async (ownerId: string, id: string) => {
    opaqueIdSchema.parse(id);
    const value = await workspace.findWorkspace(actor(ownerId), id);
    if (!value) throw new WorkspaceError("NOT_FOUND");
    return value;
  };
  const guard = async (ownerId: string, id: string, expected?: number) => {
    const current = await find(ownerId, id);
    if (expected !== undefined && current.workspaceRevision !== expected)
      throw new WorkspaceError("STALE_REVISION");
    return { ...actor(ownerId), workspaceId: id, expectedRevision: current.workspaceRevision };
  };
  const admission = async (key: string, request: unknown): Promise<Admission> => ({
    operationId: crypto.randomUUID(),
    key: idempotencyKeySchema.parse(key),
    requestHash: await runtimeDigest(request),
  });
  const mutation = async (
    ownerId: string,
    id: string,
    key: string,
    path: string,
    body: unknown,
    kind: MutationReceipt["kind"],
  ) => {
    const a = await admission(key, body);
    const route = `/api/v2/cases/${id}/${path}`;
    const replay = await accounting.findOperation(actor(ownerId), route, a.key, a.requestHash);
    if (replay?.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
    await find(ownerId, id);
    return { receipt: { ...a, route, kind }, replay: replay?.kind === "replay" };
  };
  const replayCreate = async (ownerId: string, key: string, raw: unknown) => {
    const { turnstileToken: _, ...business } = v2CreateCaseRequestSchema.parse(raw);
    const a = await admission(key, business);
    const replay = await accounting.findOperation(
      actor(ownerId),
      "/api/v2/cases",
      a.key,
      a.requestHash,
    );
    if (replay?.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
    return replay?.kind === "replay" && replay.operation.workspace_id
      ? find(ownerId, replay.operation.workspace_id)
      : null;
  };
  const queued = async (ownerId: string, operationId: string) => {
    const row = await core
      .statement("SELECT id FROM v2_jobs WHERE operation_id=?", [operationId])
      .first<{ id: string }>();
    if (!row) throw new WorkspaceError("NOT_FOUND");
    const job = await jobs.find(actor(ownerId), row.id);
    if (!job) throw new WorkspaceError("NOT_FOUND");
    return { operationId, jobId: job.id, status: "queued" as const, retryAfter: 2 };
  };
  const enqueue = async (
    ownerId: string,
    id: string,
    key: string,
    body: unknown,
    kind: WorkspaceJobInput["kind"],
  ) => {
    const request =
      kind === "chat_response"
        ? v2MessageRequestSchema.parse(body)
        : v2IntakeAdvanceRequestSchema.parse(body);
    const a = await admission(key, request);
    const responseKind =
      kind === "chat_response"
        ? "chat"
        : kind === "intake_questions"
          ? "question_batch"
          : "summary";
    const replay = await accounting.findOperation(
      actor(ownerId),
      `/api/v2/cases/${id}/${responseKind}`,
      a.key,
      a.requestHash,
    );
    if (replay?.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
    if (replay?.kind === "replay") {
      await find(ownerId, id);
      return queued(ownerId, replay.operation.id);
    }
    const g = await guard(ownerId, id, request.expectedRevision);
    if ((await accounting.usage(g)).aiResponses.remaining === 0)
      throw new WorkspaceError("USER_QUOTA_EXCEEDED");
    const chat =
      kind === "chat_response"
        ? { id: crypto.randomUUID(), request: v2MessageRequestSchema.parse(body) }
        : undefined;
    const input: WorkspaceJobInput = {
      ownerId,
      caseId: id,
      revision: g.expectedRevision + 1,
      kind,
      jobId: crypto.randomUUID(),
      admission: a,
      ...(chat ? { chat } : {}),
    };
    const prepared = await deps.prepareJob?.(input);
    if (!prepared || prepared.actor.ownerId !== ownerId)
      throw new WorkspaceError("BUDGET_UNAVAILABLE");
    if (
      !(await jobs.admitWorkspace(
        { ...g, now: prepared.actor.now },
        a,
        input.jobId,
        kind,
        chat,
        prepared.paid,
      ))
    ) {
      const duplicate = await accounting.findOperation(
        g,
        `/api/v2/cases/${id}/${responseKind}`,
        a.key,
        a.requestHash,
      );
      if (duplicate?.kind === "replay") return queued(ownerId, duplicate.operation.id);
      if (duplicate?.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
      throw new WorkspaceError("STALE_REVISION");
    }
    await deps.dispatch?.().catch(() => undefined);
    return queued(ownerId, a.operationId);
  };
  return {
    find,
    replayCreate,
    async job(ownerId: string, id: string, jobId: string) {
      const current = await find(ownerId, id);
      const job = await jobs.find(actor(ownerId), opaqueIdSchema.parse(jobId));
      if (!job || job.target.kind !== "workspace" || job.target.caseId !== id)
        throw new WorkspaceError("NOT_FOUND");
      return { ...job, retryable: canRetryV2Job(job, current) };
    },
    async latestJob(ownerId: string, id: string) {
      const current = await find(ownerId, id);
      const row = await core
        .statement(
          "SELECT j.id FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE o.owner_id=? AND j.workspace_id=? AND j.target_kind='workspace' AND j.kind IN ('intake_questions','intake_summary','chat_response') ORDER BY j.target_revision DESC,j.created_at DESC,j.id DESC LIMIT 1",
          [ownerId, id],
        )
        .first<{ id: string }>();
      const job = row ? await jobs.find(actor(ownerId), row.id) : null;
      return job ? { ...job, retryable: canRetryV2Job(job, current) } : null;
    },
    async retry(ownerId: string, id: string, jobId: string, raw: unknown) {
      const request = v2IntakeAdvanceRequestSchema.parse(raw);
      const job = await dependencyStep("retry_job", () =>
        jobs.find(actor(ownerId), opaqueIdSchema.parse(jobId)),
      );
      if (
        !job ||
        job.target.kind !== "workspace" ||
        job.target.caseId !== id ||
        !["intake_questions", "intake_summary", "chat_response"].includes(job.kind)
      )
        throw new WorkspaceError("NOT_FOUND");
      const current = await dependencyStep("retry_workspace", () => find(ownerId, id));
      if (
        job.status === "queued" ||
        job.status === "running" ||
        job.status === "validating" ||
        job.status === "completed"
      )
        return queued(ownerId, job.operationId);
      if (!canRetryV2Job(job)) throw new WorkspaceError("REVIEW_REQUIRED");
      const g = await dependencyStep("retry_workspace", () =>
        guard(ownerId, id, request.expectedRevision),
      );
      // Editing saved answers supersedes a rejected draft; the next advance makes a new job.
      if (!canRetryV2Job(job, { ...current, workspaceRevision: g.expectedRevision }))
        throw new WorkspaceError("STALE_REVISION");
      if (job.kind === "intake_questions") {
        const intake = await workspace.metadata(g, id);
        if (!intake || intake.batches.length >= V2_INTAKE_POLICY.followupRounds)
          throw new WorkspaceError("REVIEW_REQUIRED");
      }
      const operation = await dependencyStep("retry_operation", () =>
        core
          .statement(
            "SELECT revision,request_hash,key FROM v2_operations o JOIN v2_idempotency i ON i.operation_id=o.id WHERE o.id=? AND o.owner_id=?",
            [job.operationId, ownerId],
          )
          .first<{ revision: number; request_hash: string; key: string }>(),
      );
      if (!operation) throw new WorkspaceError("NOT_FOUND");
      const prior =
        job.kind === "chat_response"
          ? await dependencyStep("retry_context", () =>
              workspace.userMessage(actor(ownerId), id, job.operationId),
            )
          : undefined;
      if (job.kind === "chat_response" && !prior) throw new WorkspaceError("NOT_FOUND");
      const prepared = await dependencyStep("retry_admission", async () =>
        deps.prepareJob?.({
          ownerId,
          caseId: id,
          revision: g.expectedRevision + 1,
          operationRevision: operation.revision,
          jobId,
          kind: job.kind as WorkspaceJobInput["kind"],
          admission: {
            operationId: job.operationId,
            key: operation.key,
            requestHash: operation.request_hash,
          },
          ...(prior?.role === "user" ? { retryMessage: prior } : {}),
        }),
      );
      if (!prepared || prepared.actor.ownerId !== ownerId)
        throw new WorkspaceError("BUDGET_UNAVAILABLE");
      if (
        !(await dependencyStep("retry_commit", () =>
          jobs.retry({ ...g, now: prepared.actor.now }, jobId, prepared.paid),
        ))
      )
        throw new WorkspaceError("STALE_REVISION");
      await deps.dispatch?.().catch(() => undefined);
      return dependencyStep("retry_receipt", () => queued(ownerId, job.operationId));
    },
    async list(ownerId: string, limit = 20, before?: { createdAt: string; id: string }) {
      return workspace.list(actor(ownerId), limit, before);
    },
    async previews(ownerId: string, items: Awaited<ReturnType<typeof workspace.list>>) {
      const result: { id: string; title: string; hasSummary: boolean }[] = [];
      for (const item of items) {
        const metadata = await workspace.metadata(actor(ownerId), item.id);
        if (metadata)
          result.push({
            id: item.id,
            title: [...metadata.narrative].slice(0, 45).join(""),
            hasSummary: !!metadata.summary,
          });
      }
      return result;
    },
    async create(ownerId: string, key: string, raw: unknown) {
      const request = v2CreateCaseRequestSchema.parse(raw);
      const { turnstileToken: _, ...business } = request;
      const a = await admission(key, business);
      const result = await workspace.create(actor(ownerId), crypto.randomUUID(), request, a);
      if (result.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
      if (result.kind === "rejected") throw new WorkspaceError("USER_QUOTA_EXCEEDED");
      const id = result.kind === "created" ? result.workspace?.id : result.operation.workspace_id;
      if (!id) throw new WorkspaceError("NOT_FOUND");
      return find(ownerId, id);
    },
    async intake(ownerId: string, id: string) {
      await find(ownerId, id);
      return workspace.metadata(actor(ownerId), id);
    },
    async *summary(ownerId: string, id: string) {
      await find(ownerId, id);
      yield* workspace.summaryFragments(actor(ownerId), id);
    },
    async answers(ownerId: string, id: string, key: string, raw: unknown) {
      const request = v2AnswersRequestSchema.parse(raw);
      const m = await mutation(ownerId, id, key, "intake/answers", request, "question_batch");
      if (m.replay) return workspace.metadata(actor(ownerId), id);
      const g = await guard(ownerId, id);
      const intake = await workspace.metadata(g, id),
        batch = intake?.batches.find((candidate) =>
          request.answers.every((answer) =>
            candidate.questions.some((question) => question.id === answer.questionId),
          ),
        );
      if (batch) v2AnswersForBatchSchema(batch).parse(request);
      if (!batch || !(await workspace.answer(g, batch.id, request, m.receipt)))
        throw new WorkspaceError("STALE_REVISION");
      return workspace.metadata(actor(ownerId), id);
    },
    async advance(ownerId: string, id: string, key: string, body: unknown) {
      const a = await admission(key, v2IntakeAdvanceRequestSchema.parse(body));
      for (const kind of ["question_batch", "summary"]) {
        const saved = await accounting.findOperation(
          actor(ownerId),
          `/api/v2/cases/${id}/${kind}`,
          a.key,
          a.requestHash,
        );
        if (saved?.kind === "conflict") throw new WorkspaceError("IDEMPOTENCY_CONFLICT");
        if (saved?.kind === "replay") {
          await find(ownerId, id);
          return queued(ownerId, saved.operation.id);
        }
      }
      const current = await find(ownerId, id);
      const intake = await workspace.metadata(actor(ownerId), id);
      if (!intake || current.status !== "intake") throw new WorkspaceError("REVIEW_REQUIRED");
      if (intake.status !== "collecting") throw new WorkspaceError("REVIEW_REQUIRED");
      if (intake.batches.some((batch) => batch.answers.length !== batch.questions.length))
        throw new WorkspaceError("REVIEW_REQUIRED");
      return enqueue(
        ownerId,
        id,
        key,
        body,
        intake.batches.length < V2_INTAKE_POLICY.followupRounds
          ? "intake_questions"
          : "intake_summary",
      );
    },
    async editSummary(ownerId: string, id: string, key: string, raw: unknown) {
      const request = v2SummaryEditRequestSchema.parse(raw);
      const m = await mutation(ownerId, id, key, "summary", request, "summary");
      if (m.replay) return workspace.metadata(actor(ownerId), id);
      const g = await guard(ownerId, id);
      const current = await workspace.metadata(g, id);
      if (!current?.summary || current.summary.revision !== request.expectedRevision)
        throw new WorkspaceError("STALE_REVISION");
      const digest = await runtimeDigest({ ownerId, id, key, route: "summary" });
      const stableId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const edits = createV2SummaryEditsRepository(core);
      const old = await core
        .statement(
          "SELECT target_snapshot_id FROM v2_summary_edit_stages WHERE id=? AND owner_id=? AND workspace_id=?",
          [stableId, ownerId, id],
        )
        .first<{ target_snapshot_id: string }>();
      const started = await edits.begin(g, {
        id: stableId,
        summaryId: current.summary.id,
        targetSnapshotId: old?.target_snapshot_id ?? crypto.randomUUID(),
        request,
        expiresAt: new Date(Date.parse(g.now) + 1800000).toISOString(),
      });
      if (!started) throw new WorkspaceError(old ? "IDEMPOTENCY_CONFLICT" : "STALE_REVISION");
      // Large snapshots resume with the same key; each request does bounded work.
      for (let step = 0; step < 8; step++) {
        const progress = await edits.advance(g, stableId);
        if (!progress) throw new WorkspaceError("STALE_REVISION");
        if (progress.done) {
          if (
            !(await edits.publish(g, stableId, crypto.randomUUID(), {
              ...m.receipt,
              operationId: stableId,
            }))
          )
            throw new WorkspaceError("STALE_REVISION");
          return workspace.metadata(actor(ownerId), id);
        }
      }
      return {
        ...(await workspace.metadata(actor(ownerId), id)),
        edit: { id: stableId, status: "processing" as const, retryAfter: 1 },
      };
    },
    async confirm(ownerId: string, id: string, key: string, raw: unknown) {
      const request = v2SummaryConfirmationRequestSchema.parse(raw);
      const m = await mutation(ownerId, id, key, "summary/confirm", request, "summary");
      if (m.replay) return find(ownerId, id);
      const g = await guard(ownerId, id);
      if (!(await workspace.confirmSummary(g, request, m.receipt)))
        throw new WorkspaceError("STALE_REVISION");
      return find(ownerId, id);
    },
    send: (ownerId: string, id: string, key: string, body: unknown) =>
      enqueue(ownerId, id, key, body, "chat_response"),
    async messages(
      ownerId: string,
      id: string,
      limit = 20,
      before?: { createdAt: string; id: string },
    ) {
      await find(ownerId, id);
      return workspace.messages(actor(ownerId), id, limit, before);
    },
    async actions(ownerId: string, id: string, after?: string) {
      await find(ownerId, id);
      return workspace.actions(actor(ownerId), id, after, 8);
    },
    async timeline(ownerId: string, id: string, after?: string) {
      await find(ownerId, id);
      return workspace.timeline(actor(ownerId), id, after, 8);
    },
    async updateAction(ownerId: string, id: string, actionId: string, key: string, raw: unknown) {
      const body = v2ActionUpdateRequestSchema.parse(raw);
      const m = await mutation(
        ownerId,
        id,
        key,
        `actions/${opaqueIdSchema.parse(actionId)}`,
        body,
        "chat",
      );
      const g = await guard(ownerId, id);
      if (!m.replay && (await find(ownerId, id)).currentJobId)
        throw new WorkspaceError("STALE_REVISION");
      const row = await core
        .statement(
          "SELECT id,revision,encrypted_payload FROM v2_actions WHERE workspace_id=? AND entity_id=?",
          [id, opaqueIdSchema.parse(actionId)],
        )
        .first<{ id: string; revision: number; encrypted_payload: string }>();
      if (!row) throw new WorkspaceError("NOT_FOUND");
      const { v2ActionSchema } = await import("../../../contracts/v2");
      const value = await core.decrypt(
        "v2_actions",
        row.id,
        ownerId,
        row.revision,
        row.encrypted_payload,
        v2ActionSchema,
      );
      if (m.replay) return value;
      if (
        body.expectedRevision !== row.revision ||
        !(await workspace.writeAction(
          g,
          { ...value, revision: row.revision + 1, status: body.status },
          row.revision,
          m.receipt,
        ))
      )
        throw new WorkspaceError("STALE_REVISION");
      return { ...value, revision: row.revision + 1, status: body.status };
    },
    async createTimeline(ownerId: string, id: string, key: string, raw: unknown) {
      const body = v2TimelineEditRequestSchema.parse(raw);
      const m = await mutation(ownerId, id, key, "timeline", body, "chat");
      const digest = await runtimeDigest({ ownerId, id, key, route: "timeline" });
      const entryId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const { v2TimelineEntrySchema } = await import("../../../contracts/v2");
      if (m.replay) {
        const row = await core
          .statement(
            "SELECT id,revision,encrypted_payload FROM v2_timeline WHERE workspace_id=? AND entity_id=?",
            [id, entryId],
          )
          .first<{ id: string; revision: number; encrypted_payload: string }>();
        if (!row) throw new WorkspaceError("NOT_FOUND");
        return core.decrypt(
          "v2_timeline",
          row.id,
          ownerId,
          row.revision,
          row.encrypted_payload,
          v2TimelineEntrySchema,
        );
      }
      const g = await guard(ownerId, id, body.expectedRevision);
      const entry = v2TimelineEntrySchema.parse({
        id: entryId,
        revision: 1,
        date: body.date,
        datePrecision: body.datePrecision,
        event: body.event,
        certainty: "reported",
        references: [],
        factIds: [],
        userEdited: true,
      });
      if (!(await workspace.writeTimeline(g, entry, null, m.receipt)))
        throw new WorkspaceError("STALE_REVISION");
      return entry;
    },
    async editTimeline(ownerId: string, id: string, entryId: string, key: string, raw: unknown) {
      const body = v2TimelineEditRequestSchema.parse(raw);
      const m = await mutation(
        ownerId,
        id,
        key,
        `timeline/${opaqueIdSchema.parse(entryId)}`,
        body,
        "chat",
      );
      const g = await guard(ownerId, id);
      if (!m.replay && (await find(ownerId, id)).currentJobId)
        throw new WorkspaceError("STALE_REVISION");
      const row = await core
        .statement(
          "SELECT id,revision,encrypted_payload FROM v2_timeline WHERE workspace_id=? AND entity_id=?",
          [id, opaqueIdSchema.parse(entryId)],
        )
        .first<{ id: string; revision: number; encrypted_payload: string }>();
      if (!row) throw new WorkspaceError("NOT_FOUND");
      const { v2TimelineEntrySchema } = await import("../../../contracts/v2");
      const value = await core.decrypt(
        "v2_timeline",
        row.id,
        ownerId,
        row.revision,
        row.encrypted_payload,
        v2TimelineEntrySchema,
      );
      if (m.replay) return value;
      const updated = {
        ...value,
        revision: row.revision + 1,
        date: body.date,
        datePrecision: body.datePrecision,
        event: body.event,
        certainty: "reported" as const,
        userEdited: true,
      };
      if (
        body.expectedRevision !== row.revision ||
        !(await workspace.writeTimeline(g, updated, row.revision, m.receipt))
      )
        throw new WorkspaceError("STALE_REVISION");
      return updated;
    },
    async state(ownerId: string, id: string, key: string, raw: unknown) {
      const body = v2WorkspaceStateRequestSchema.parse(raw);
      const m = await mutation(ownerId, id, key, "state", body, "chat");
      if (m.replay) return find(ownerId, id);
      const g = await guard(ownerId, id, body.expectedRevision);
      if (!(await workspace.changeState(g, body.action, m.receipt)))
        throw new WorkspaceError("STALE_REVISION");
      return find(ownerId, id);
    },
  };
}
