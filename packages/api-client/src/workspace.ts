import type {
  ActionView,
  CaseView,
  FileView,
  MessageView,
  SessionScope,
  TimelineView,
  WorkspaceView,
} from "@baro/client-core";
import { workspaceProgressText } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { caseDetailResponseSchema, opaqueIdSchema } from "@baro/contracts/v1";
import {
  v2AcceptedOperationSchema,
  v2ActionSchema,
  v2EntityMutationReceiptSchema,
  v2FactReferenceSchema,
  v2FailureCodeSchema,
  v2FileProcessingSchema,
  v2JobSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
  v2UserMessageSchema,
  v2WorkspaceSchema,
} from "@baro/contracts/v2";
import { z } from "zod";
import type { CaseOperationStorage } from "./cases";
import { ApiError } from "./errors";
import {
  createWorkspaceOperations,
  type WorkspaceTransport,
  workspaceError,
  workspaceResponse,
} from "./workspace-http";
import { createWorkspaceRecovery, type WorkspaceRecovery } from "./workspace-recovery";

const messageSources = {
  references: z.array(v2FactReferenceSchema).default([]),
  citations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.url().refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
};
const fileViewSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive().optional(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["uploading", "processing", "ready", "failed", "waiting"]),
  coverage: z.string(),
  extractedText: z.string(),
  canStartProcessing: z.boolean().optional(),
  uploadRejection: z.literal("FILE_REJECTED").optional(),
  canRetry: z.boolean().optional(),
  processing: v2FileProcessingSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  failure: v2FailureCodeSchema.nullable().optional(),
});
export const workspaceViewSchema = z.object({
  case: z.object({
    id: z.string(),
    title: z.string(),
    subjectContext: z.enum(["individual", "company"]),
    stage: z.enum(["intake", "summary", "active", "archived"]),
    revision: z.number().int().positive(),
    updatedAt: z.string(),
    summary: z.string(),
    schemaVersion: z.enum(["1", "2"]).optional(),
  }),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      status: z.enum(["pending", "complete", "failed"]),
      retryable: z.boolean().optional(),
      createdAt: z.string(),
      statusUpdatedAt: z.iso.datetime({ offset: true }).optional(),
      selectedFileIds: v2UserMessageSchema.shape.selectedFileIds.optional(),
      ...messageSources,
    }),
  ),
  actions: z.array(
    z.object({ id: z.string(), title: z.string(), detail: z.string(), done: z.boolean() }),
  ),
  timeline: z.array(
    z.object({
      id: z.string(),
      revision: z.number().int().positive().optional(),
      date: z.string(),
      datePrecision: z.enum(["day", "month", "year", "unknown"]).default("day"),
      title: z.string(),
      detail: z.string(),
    }),
  ),
  files: z.array(fileViewSchema),
  pagination: z
    .object({ messages: z.boolean(), actions: z.boolean(), timeline: z.boolean() })
    .optional(),
});
function parseView(value: unknown): WorkspaceView {
  const parsed = workspaceViewSchema.safeParse(value);
  if (!parsed.success) throw workspaceError("UNAVAILABLE", "사건 응답을 확인하지 못했어요.", true);
  const { schemaVersion, ...caseFields } = parsed.data.case;
  return { ...parsed.data, case: { ...caseFields, ...(schemaVersion ? { schemaVersion } : {}) } };
}
export type CustomerWorkspaceView = WorkspaceView;
export interface WorkspaceAcknowledgement {
  kind: "message" | "retry" | "action" | "timeline";
  caseId: string;
  resourceId?: string;
  jobId?: string;
  committedWorkspaceRevision?: number;
}
export function createWorkspaceClient(dependencies: {
  request: WorkspaceTransport;
  scope: SessionScope;
  /** Only opt in when the adapter controls credential changes through this scope. */
  coalesceWrites?: "credential-scope";
  signal?: AbortSignal;
  newKey: () => string;
  listFiles: (
    id: string,
    options: { metadataOnly: true; signal: AbortSignal },
  ) => Promise<FileView[]>;
  /** Recovery hint only; the server's owner-checked latest job remains authoritative. */
  jobStorage?: CaseOperationStorage | null;
  /** Native-owned credentials only. Required durable write/readback precedes mutation dispatch. */
  recovery?: WorkspaceRecovery;
  /** Opt-in wire entity revisions so a native editor can retain its original revision across recreation. */
  includeActionRevisions?: boolean;
  onAcknowledged?: (receipt: WorkspaceAcknowledgement) => void;
}) {
  const generation = dependencies.scope.snapshot();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
    : dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const request: WorkspaceTransport = async (path, init = {}) => {
    ensureCurrent();
    try {
      const response = await dependencies.request(path, {
        ...init,
        ...(dependencies.recovery
          ? {
              headers: {
                ...Object.fromEntries(new Headers(init.headers)),
                [EXPECTED_OWNER_HEADER]: encodeURIComponent(dependencies.recovery.ownerId),
              },
            }
          : {}),
        signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
      });
      ensureCurrent();
      return response;
    } catch (error) {
      ensureCurrent();
      throw error;
    }
  };
  const storage = dependencies.jobStorage;
  const { workspaceJson, workspaceMutation } = createWorkspaceOperations(dependencies.newKey);
  const recovery = dependencies.recovery
    ? createWorkspaceRecovery({
        recovery: dependencies.recovery,
        scope: dependencies.scope,
        ensureCurrent,
        newKey: dependencies.newKey,
      })
    : undefined;
  const notifyAcknowledgement = (receipt: WorkspaceAcknowledgement) => {
    ensureCurrent();
    try {
      dependencies.onAcknowledged?.(receipt);
    } catch {
      /* An observer cannot undo a committed acknowledgement. */
    }
  };
  const files = {
    list: async (id: string, options: { metadataOnly: true }) => {
      ensureCurrent();
      try {
        const value = await dependencies.listFiles(id, { ...options, signal });
        ensureCurrent();
        return value;
      } catch (error) {
        ensureCurrent();
        throw error;
      }
    },
  };
  const base = (id: string) => `/api/v2/cases/${encodeURIComponent(opaqueIdSchema.parse(id))}`;
  const actionRevisions = new Map<string, number>();
  const timelineRevisions = new Map<string, number>();
  const messageJobs = new Map<string, { jobId: string; revision: number }>();
  const schemaVersions = new Map<string, "1" | "2">();
  const workspaceRevisions = new Map<string, number>();
  const snapshots = new Map<
    string,
    {
      revision: number;
      intake: unknown;
      messagesRaw: Awaited<ReturnType<typeof allMessages>>;
      actionsRaw: Awaited<ReturnType<typeof allEntities>>;
      timelineRaw: Awaited<ReturnType<typeof allEntities>>;
      summary: z.infer<typeof v2SummarySchema> | null;
    }
  >();
  const historyLimits = new Map<string, { messages: number; actions: number; timeline: number }>();
  const pageRequests = new Map<string, Promise<CustomerWorkspaceView>>();
  const pendingMessages = new Map<string, RequestInit>();
  const pendingTimelines = new Map<string, RequestInit>();
  const pendingActions = new Map<string, { done: boolean; init: RequestInit }>();
  const knownJobs = new Map<string, string>();
  async function rememberJob(id: string, jobId: string | null) {
    ensureCurrent();
    if (jobId) knownJobs.set(id, jobId);
    else knownJobs.delete(id);
    try {
      // Only an opaque resource ID is retained; no message, case facts or auth token.
      if (jobId) await storage?.setItem(`baro-workspace-job:${id}`, jobId);
      else await storage?.removeItem(`baro-workspace-job:${id}`);
    } catch {
      /* The current page still keeps the job when storage is unavailable. */
    }
  }
  async function rememberedJob(id: string) {
    ensureCurrent();
    if (knownJobs.has(id)) return knownJobs.get(id) ?? null;
    try {
      const parsed = opaqueIdSchema.safeParse(await storage?.getItem(`baro-workspace-job:${id}`));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  // The server validates official hosts; the UI preserves its evidence and rejects unsafe URLs.
  const messageTextSchema = z.discriminatedUnion("role", [
    v2UserMessageSchema,
    z.object({
      schemaVersion: v2UserMessageSchema.shape.schemaVersion,
      id: v2UserMessageSchema.shape.id,
      operationId: v2UserMessageSchema.shape.operationId,
      workspaceRevision: v2UserMessageSchema.shape.workspaceRevision,
      createdAt: v2UserMessageSchema.shape.createdAt,
      role: z.literal("assistant"),
      safety: z.literal("validated"),
      text: v2UserMessageSchema.shape.text,
      ...messageSources,
    }),
  ]);
  async function get(
    id: string,
    recovery = 0,
    more?: "messages" | "actions" | "timeline",
    filesOnly: boolean | "evidence" = false,
    readback?: {
      previousRevision: number;
      committedRevision: number;
      collection: "actions" | "timeline";
    },
  ): Promise<CustomerWorkspaceView> {
    const response = await request(`${base(id)}/workspace`);
    if (response.status === 404) {
      if (schemaVersions.get(id) === "2") await workspaceResponse(response);
      const legacyResponse = await request(`/api/cases/${encodeURIComponent(id)}`);
      if (legacyResponse.status >= 500 && schemaVersions.get(id) !== "1")
        throw workspaceError("NOT_FOUND", "사건을 찾을 수 없어요.");
      const legacy = caseDetailResponseSchema.safeParse(
        await (await workspaceResponse(legacyResponse)).json(),
      );
      if (!legacy.success) throw workspaceError("NOT_FOUND", "사건을 찾을 수 없어요.");
      schemaVersions.set(id, "1");
      return {
        case: {
          id,
          title: legacy.data.title,
          subjectContext: "individual",
          stage: "active",
          revision: legacy.data.inputRevision,
          updatedAt: new Date().toISOString(),
          summary: "",
          schemaVersion: "1",
        },
        messages: [],
        actions: [],
        timeline: [],
        files: [],
      };
    }
    const value: unknown = await (await workspaceResponse(response)).json();
    if (workspaceViewSchema.safeParse(value).success) {
      const view = parseView(value);
      if (filesOnly && view.case.id !== id)
        throw workspaceError("NOT_FOUND", "사건을 찾을 수 없어요.");
      schemaVersions.set(id, view.case.schemaVersion ?? "2");
      workspaceRevisions.set(id, view.case.revision);
      for (const action of view.actions)
        actionRevisions.set(`${id}:${action.id}`, view.case.revision);
      for (const entry of view.timeline)
        timelineRevisions.set(`${id}:${entry.id}`, view.case.revision);
      return view;
    }
    const w = v2WorkspaceSchema.parse(value);
    schemaVersions.set(id, "2");
    workspaceRevisions.set(id, w.workspaceRevision);
    if (filesOnly) {
      // Default material reads stay metadata-only. Explicit evidence navigation
      // also reads current facts and at most 100 recent messages, never file bodies,
      // actions or timeline. Fence both projections against a workspace change.
      const [fileViews, evidenceSummary, evidenceMessages] = await Promise.all([
        files.list(id, { metadataOnly: true }),
        filesOnly === "evidence" && w.confirmedSummaryRevision !== null
          ? workspaceJson(request, `${base(id)}/summary`).then((value) =>
              v2SummarySchema.parse(value),
            )
          : Promise.resolve(null),
        filesOnly === "evidence" ? allMessages(id, null, 100) : Promise.resolve(null),
      ]);
      const settled = v2WorkspaceSchema.parse(
        await workspaceJson(request, `${base(id)}/workspace`),
      );
      if (w.id !== id || settled.id !== id || settled.workspaceRevision !== w.workspaceRevision)
        throw workspaceError(
          "UNAVAILABLE",
          "사건이 갱신되어 최신 자료 목록을 다시 불러와 주세요.",
          true,
        );
      return {
        case: {
          id: w.id,
          title: w.title,
          subjectContext: w.subjectContext,
          stage: w.status,
          revision: w.workspaceRevision,
          updatedAt: w.updatedAt,
          summary: "",
          schemaVersion: "2",
        },
        files: fileViews,
        messages:
          evidenceMessages?.items
            .filter((message) => message.role === "assistant")
            .map((message) => ({
              id: message.id,
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
              status: "complete" as const,
              references: message.references,
            })) ?? [],
        ...(evidenceSummary ? { facts: evidenceSummary.facts } : {}),
        actions: [],
        timeline: [],
      };
    }
    const previous = snapshots.get(id);
    // A commit receipt identifies the one local write. Reuse other collections only
    // when both fresh workspace reads match that exact next revision. Replays and
    // peer/job changes that advanced farther take the normal full read path.
    const partial = Boolean(
      readback &&
        previous?.revision === readback.previousRevision &&
        readback.committedRevision === readback.previousRevision + 1 &&
        w.workspaceRevision === readback.committedRevision &&
        !w.currentJobId,
    );
    const cached = partial && previous ? { ...previous, revision: w.workspaceRevision } : previous;
    const limits = historyLimits.get(id) ?? { messages: 500, actions: 1000, timeline: 1000 };
    let [intake, messagesRaw, actionsRaw, timelineRaw, fileViews] = await Promise.all([
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.intake)
        : workspaceJson(request, `${base(id)}/intake`),
      cached?.revision === w.workspaceRevision
        ? more === "messages"
          ? extendPage(cached.messagesRaw, (cursor) => allMessages(id, cursor))
          : Promise.resolve(cached.messagesRaw)
        : allMessages(id, null, limits.messages),
      cached?.revision === w.workspaceRevision && !(partial && readback?.collection === "actions")
        ? more === "actions"
          ? extendPage(cached.actionsRaw, (cursor) => allEntities(id, "actions", cursor))
          : Promise.resolve(cached.actionsRaw)
        : allEntities(id, "actions", null, limits.actions),
      cached?.revision === w.workspaceRevision && !(partial && readback?.collection === "timeline")
        ? more === "timeline"
          ? extendPage(cached.timelineRaw, (cursor) => allEntities(id, "timeline", cursor))
          : Promise.resolve(cached.timelineRaw)
        : allEntities(id, "timeline", null, limits.timeline),
      // Chat/history use material names and states. Coverage is read by the
      // files review and report screens at their existing fresh boundaries.
      files.list(id, { metadataOnly: true }),
    ]);
    const metadata = z
      .object({ narrative: z.string(), summary: z.object({ revision: z.number() }).nullable() })
      .parse(intake);
    const summary =
      cached?.revision === w.workspaceRevision
        ? cached.summary
        : metadata.summary
          ? v2SummarySchema.parse(await workspaceJson(request, `${base(id)}/summary`))
          : null;
    const settled = v2WorkspaceSchema.parse(await workspaceJson(request, `${base(id)}/workspace`));
    const newest = snapshots.get(id);
    if (
      settled.workspaceRevision !== w.workspaceRevision ||
      (newest && newest.revision > w.workspaceRevision)
    ) {
      if (newest?.revision === w.workspaceRevision) snapshots.delete(id);
      if (recovery < 2) return get(id, recovery + 1);
      throw workspaceError("UNAVAILABLE", "사건이 갱신되어 최신 내용을 다시 불러와 주세요.", true);
    }
    // A delayed refresh must preserve pages opened while its file requests were pending.
    if (newest?.revision === w.workspaceRevision) {
      if (newest.messagesRaw.items.length > messagesRaw.items.length)
        messagesRaw = newest.messagesRaw;
      if (newest.actionsRaw.items.length > actionsRaw.items.length) actionsRaw = newest.actionsRaw;
      if (newest.timelineRaw.items.length > timelineRaw.items.length)
        timelineRaw = newest.timelineRaw;
    }
    workspaceRevisions.set(id, w.workspaceRevision);
    snapshots.set(id, {
      revision: w.workspaceRevision,
      intake,
      messagesRaw,
      actionsRaw,
      timelineRaw,
      summary,
    });
    // Refresh the range the user already opened after a write or peer update.
    historyLimits.set(id, {
      messages: Math.max(limits.messages, messagesRaw.items.length),
      actions: Math.max(limits.actions, actionsRaw.items.length),
      timeline: Math.max(limits.timeline, timelineRaw.items.length),
    });
    if (snapshots.size > 20) {
      const oldest = snapshots.keys().next().value ?? "";
      snapshots.delete(oldest);
      historyLimits.delete(oldest);
    }
    const messages: MessageView[] = [...messagesRaw.items]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        status: "complete",
        createdAt: m.createdAt,
        ...(m.role === "assistant"
          ? { references: m.references, citations: m.citations, warnings: m.warnings }
          : { selectedFileIds: m.selectedFileIds }),
      }));
    let jobId = w.currentJobId ?? (await rememberedJob(id));
    let latestJob: z.infer<typeof v2JobSchema> | null = null;
    if (!w.currentJobId) {
      const latest = await request(`${base(id)}/workspace-jobs/latest`);
      if (latest.status !== 404) {
        latestJob = v2JobSchema.nullable().parse(await (await workspaceResponse(latest)).json());
        jobId = latestJob?.id ?? null;
        if (!jobId) await rememberJob(id, null);
      }
    }
    if (jobId) {
      let job = latestJob;
      if (!job) {
        const response = await request(`${base(id)}/workspace-jobs/${encodeURIComponent(jobId)}`);
        job =
          response.status === 404 && !w.currentJobId
            ? null
            : v2JobSchema.parse(await (await workspaceResponse(response)).json());
      }
      if (
        job?.kind === "chat_response" &&
        job.status === "completed" &&
        (!messagesRaw.items.some(
          (m) => m.role === "assistant" && m.operationId === job.operationId,
        ) ||
          messagesRaw.items.some((m) => m.workspaceRevision > w.workspaceRevision))
      ) {
        snapshots.delete(id);
        if (recovery < 2) return get(id, recovery + 1);
        throw workspaceError("UNAVAILABLE", "완료된 응답을 다시 확인해 주세요.", true);
      }
      if (!job || ["completed", "cancelled", "superseded"].includes(job.status))
        await rememberJob(id, null);
      if (
        job &&
        job.kind === "chat_response" &&
        job.target.kind === "workspace" &&
        job.target.caseId === id &&
        ["queued", "running", "validating", "failed"].includes(job.status)
      ) {
        await rememberJob(id, job.id);
        const messageId = `job:${job.id}`;
        messageJobs.set(messageId, { jobId: job.id, revision: w.workspaceRevision });
        messages.push({
          id: messageId,
          role: "assistant",
          text: job.status === "failed" ? "응답을 완료하지 못했어요." : workspaceProgressText(job),
          status: job.status === "failed" ? "failed" : "pending",
          retryable:
            job.status === "failed" &&
            job.retryable &&
            job.failure !== "POLICY_REJECTED" &&
            job.attempts < 10,
          createdAt: job.updatedAt,
          statusUpdatedAt: job.updatedAt,
          warnings:
            job.status === "failed" &&
            ["CITATION_INVALID", "POLICY_REJECTED", "MODEL_SCHEMA_INVALID"].includes(
              job.failure ?? "",
            )
              ? ["답변 검증을 통과하지 못해 내용을 표시하지 않았어요. 원본과 출처를 확인해 주세요."]
              : [],
        });
      }
    }
    const latest = snapshots.get(id);
    if (
      latest &&
      (latest.revision !== w.workspaceRevision ||
        latest.messagesRaw.items.length > messagesRaw.items.length ||
        latest.actionsRaw.items.length > actionsRaw.items.length ||
        latest.timelineRaw.items.length > timelineRaw.items.length)
    ) {
      if (recovery < 2) return get(id, recovery + 1);
      throw workspaceError("UNAVAILABLE", "사건이 갱신되어 최신 내용을 다시 불러와 주세요.", true);
    }
    const actions = actionsRaw.items.map((a) => {
      const item = v2ActionSchema.parse(a);
      actionRevisions.set(`${id}:${item.id}`, item.revision);
      return {
        id: item.id,
        ...(dependencies.includeActionRevisions ? { revision: item.revision } : {}),
        title: item.title,
        detail: `${item.instructions}\n${item.caution}`,
        done: item.status === "done",
      } satisfies ActionView;
    });
    const timeline = timelineRaw.items.map((t) => {
      const item = v2TimelineEntrySchema.parse(t);
      timelineRevisions.set(`${id}:${item.id}`, item.revision);
      const [title, ...detail] = item.event.split("\n");
      return {
        id: item.id,
        revision: item.revision,
        date: item.date ?? "",
        datePrecision: item.datePrecision,
        title: title ?? item.event,
        detail: detail.join("\n"),
      } satisfies TimelineView;
    });
    const caseView: CaseView = {
      id: w.id,
      title: [...metadata.narrative].slice(0, 60).join("") || w.title,
      subjectContext: w.subjectContext,
      stage: w.status,
      revision: w.workspaceRevision,
      updatedAt: w.updatedAt,
      summary: summary?.overview ?? "",
      schemaVersion: "2",
    };
    return {
      case: caseView,
      pagination: {
        messages: Boolean(messagesRaw.nextCursor),
        actions: Boolean(actionsRaw.nextCursor),
        timeline: Boolean(timelineRaw.nextCursor),
      },
      messages,
      actions,
      timeline,
      files: fileViews,
      facts: summary?.facts ?? [],
      people: summary?.parties ?? [],
      unknowns: summary?.unknowns ?? [],
      notices: summary?.notices ?? [],
    };
  }
  async function mutationReadback(
    id: string,
    previousRevision: number | undefined,
    acknowledged: unknown,
    collection: "actions" | "timeline",
  ) {
    const receipt = v2EntityMutationReceiptSchema.safeParse(acknowledged);
    return get(
      id,
      0,
      undefined,
      false,
      previousRevision !== undefined && receipt.success
        ? {
            previousRevision,
            committedRevision: receipt.data.committedWorkspaceRevision,
            collection,
          }
        : undefined,
    );
  }
  async function allMessages(id: string, after: string | null = null, limit = 500) {
    const items: z.infer<typeof messageTextSchema>[] = [];
    let cursor = after;
    const seen = new Set<string>(after ? [after] : []);
    do {
      const page = z
        .object({ items: z.array(messageTextSchema), nextCursor: z.string().nullable() })
        .parse(
          await workspaceJson(
            request,
            `${base(id)}/messages?limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
          ),
        );
      items.unshift(...page.items);
      cursor = page.nextCursor;
      checkCursor(cursor, page.items.length, seen);
      if (items.length >= limit) break;
    } while (cursor);
    return { items, nextCursor: cursor };
  }
  async function allEntities(
    id: string,
    name: "actions" | "timeline",
    after: string | null = null,
    limit = 1000,
  ) {
    const items: unknown[] = [];
    let cursor = after;
    const seen = new Set<string>(after ? [after] : []);
    do {
      const page = z
        .object({ items: z.array(z.unknown()), nextCursor: z.string().nullable() })
        .parse(
          await workspaceJson(
            request,
            `${base(id)}/${name}${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
          ),
        );
      items.push(...page.items);
      cursor = page.nextCursor;
      checkCursor(cursor, page.items.length, seen);
      if (items.length >= limit) break;
    } while (cursor);
    return { items, nextCursor: cursor };
  }
  function checkCursor(cursor: string | null, count: number, seen: Set<string>) {
    if (!cursor) return;
    if (!count || seen.has(cursor))
      throw workspaceError(
        "UNAVAILABLE",
        "다음 기록을 불러오지 못했어요. 다시 확인해 주세요.",
        true,
      );
    seen.add(cursor);
  }
  async function extendPage<T>(
    page: { items: T[]; nextCursor: string | null },
    read: (cursor: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  ) {
    if (!page.nextCursor) return page;
    const next = await read(page.nextCursor);
    return { items: [...page.items, ...next.items], nextCursor: next.nextCursor };
  }
  async function mutation(id: string, path: string, body: unknown, method = "POST") {
    const init = recovery
      ? await recovery.prepare(`${base(id)}/${path}`, body, method)
      : workspaceMutation(`${base(id)}/${path}`, body, method);
    await workspaceJson(request, `${base(id)}/${path}`, init);
    const next = await get(id);
    await recovery?.complete(init);
    return next;
  }
  const client = {
    get,
    getFiles: (id: string, options?: { evidence?: boolean }) =>
      get(id, 0, undefined, options?.evidence ? "evidence" : true),
    async loadMore(id: string, collection: "messages" | "actions" | "timeline") {
      // Serialize continuation reads so repeated clicks cannot append the same page.
      const previous = pageRequests.get(id) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(() => get(id, 0, collection));
      pageRequests.set(id, next);
      try {
        return await next;
      } finally {
        if (pageRequests.get(id) === next) pageRequests.delete(id);
      }
    },
    async sendMessage(
      id: string,
      input: { expectedRevision: number; text: string; selectedFileIds: string[] },
    ) {
      const path = `${base(id)}/messages`;
      const signature = JSON.stringify({ id, input });
      const init =
        pendingMessages.get(signature) ??
        (recovery ? await recovery.prepare(path, input) : workspaceMutation(path, input));
      pendingMessages.set(signature, init);
      const value = await workspaceJson(request, path, init);
      const accepted = v2AcceptedOperationSchema.safeParse(value);
      if (accepted.success) {
        notifyAcknowledgement({ kind: "message", caseId: id, jobId: accepted.data.jobId });
        await rememberJob(id, accepted.data.jobId);
      } else if (recovery)
        throw workspaceError("UNAVAILABLE", "전송 결과를 다시 확인해 주세요.", true);
      const next = await get(id);
      await recovery?.complete(init);
      pendingMessages.delete(signature);
      return next;
    },
    async retryMessage(id: string, messageId: string, expectedRevision?: number) {
      // mock has the same request route; real recovers current failed job after reload.
      if (!messageJobs.has(messageId)) await get(id);
      const job = messageJobs.get(messageId);
      const path = job
        ? `workspace-jobs/${encodeURIComponent(job.jobId)}/retry`
        : `messages/${encodeURIComponent(messageId)}/retry`;
      if (job) {
        const body = { expectedRevision: expectedRevision ?? job.revision };
        const init = recovery
          ? await recovery.prepare(`${base(id)}/${path}`, body)
          : workspaceMutation(`${base(id)}/${path}`, body);
        const accepted = v2AcceptedOperationSchema.parse(
          await workspaceJson(request, `${base(id)}/${path}`, init),
        );
        notifyAcknowledgement({
          kind: "retry",
          caseId: id,
          resourceId: messageId,
          jobId: accepted.jobId,
        });
        await rememberJob(id, accepted.jobId);
        const next = await get(id);
        await recovery?.complete(init);
        return next;
      } else return mutation(id, path, {});
    },
    async setAction(id: string, actionId: string, done: boolean, expectedRevision?: number) {
      if (!actionRevisions.has(`${id}:${actionId}`)) await get(id);
      const route = `${base(id)}/actions/${encodeURIComponent(actionId)}`;
      const signature = JSON.stringify({
        id,
        actionId,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      });
      const pending = pendingActions.get(signature);
      const body = {
        expectedRevision: expectedRevision ?? actionRevisions.get(`${id}:${actionId}`) ?? 1,
        status: done ? "done" : "todo",
      };
      const init =
        pending?.done === done
          ? pending.init
          : recovery
            ? await recovery.prepare(route, body, "PUT")
            : workspaceMutation(route, body, "PUT");
      pendingActions.set(signature, { done, init });
      const previousRevision = snapshots.get(id)?.revision;
      let acknowledged: unknown;
      try {
        acknowledged = await workspaceJson(request, route, init);
      } catch (cause) {
        if (
          (cause as { code?: string }).code === "CONFLICT" &&
          pendingActions.get(signature)?.init === init
        )
          pendingActions.delete(signature);
        throw cause;
      }
      const receipt = v2EntityMutationReceiptSchema.safeParse(acknowledged);
      if (receipt.success)
        notifyAcknowledgement({
          kind: "action",
          caseId: id,
          resourceId: actionId,
          ...receipt.data,
        });
      else if (recovery)
        throw workspaceError("UNAVAILABLE", "저장 결과를 다시 확인해 주세요.", true);
      const next = await mutationReadback(id, previousRevision, acknowledged, "actions");
      await recovery?.complete(init);
      if (pendingActions.get(signature)?.init === init) pendingActions.delete(signature);
      return next;
    },
    async saveTimeline(
      id: string,
      entry: Omit<TimelineView, "id"> & { id?: string; expectedRevision?: number },
    ) {
      if (entry.id && !timelineRevisions.has(`${id}:${entry.id}`)) await get(id);
      const route = `${base(id)}/timeline${entry.id ? `/${encodeURIComponent(entry.id)}` : ""}`;
      const signature = JSON.stringify({ id, entry });
      let init = pendingTimelines.get(signature);
      if (!init) {
        const body = {
          expectedRevision:
            entry.expectedRevision ??
            entry.revision ??
            (entry.id
              ? (timelineRevisions.get(`${id}:${entry.id}`) ?? 1)
              : (workspaceRevisions.get(id) ?? (await get(id)).case.revision)),
          date: entry.date || null,
          datePrecision: entry.date ? (entry.datePrecision ?? "day") : "unknown",
          event: entry.detail ? `${entry.title}\n${entry.detail}` : entry.title,
        };
        const method = entry.id ? "PUT" : "POST";
        init = recovery
          ? await recovery.prepare(route, body, method)
          : workspaceMutation(route, body, method);
        pendingTimelines.set(signature, init);
      }
      const previousRevision = snapshots.get(id)?.revision;
      let acknowledged: unknown;
      try {
        acknowledged = await workspaceJson(request, route, init);
      } catch (cause) {
        if (
          (cause as { code?: string }).code === "CONFLICT" &&
          pendingTimelines.get(signature) === init
        )
          pendingTimelines.delete(signature);
        throw cause;
      }
      const receipt = v2EntityMutationReceiptSchema.safeParse(acknowledged);
      if (receipt.success)
        notifyAcknowledgement({
          kind: "timeline",
          caseId: id,
          ...(entry.id ? { resourceId: entry.id } : {}),
          ...receipt.data,
        });
      else if (recovery)
        throw workspaceError("UNAVAILABLE", "저장 결과를 다시 확인해 주세요.", true);
      const next = await mutationReadback(id, previousRevision, acknowledged, "timeline");
      await recovery?.complete(init);
      pendingTimelines.delete(signature);
      return next;
    },
  };
  const writes = new Set(["sendMessage", "retryMessage", "setAction", "saveTimeline"]);
  const pendingWrites = new Map<string, Promise<unknown>>();
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        ensureCurrent();
        const invoke = async () => {
          try {
            const result = await Reflect.apply(value, target, args);
            ensureCurrent();
            return result;
          } catch (error) {
            ensureCurrent();
            throw error;
          }
        };
        if (
          dependencies.coalesceWrites !== "credential-scope" ||
          typeof key !== "string" ||
          !writes.has(key)
        )
          return invoke();
        const identity = JSON.stringify([key, args]);
        const previous = pendingWrites.get(identity);
        if (previous) return previous;
        const task = invoke();
        pendingWrites.set(identity, task);
        try {
          return await task;
        } finally {
          if (pendingWrites.get(identity) === task) pendingWrites.delete(identity);
        }
      };
    },
  });
}
