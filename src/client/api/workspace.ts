import { z } from "zod";
import { caseDetailResponseSchema, opaqueIdSchema } from "../../contracts";
import {
  v2AcceptedOperationSchema,
  v2ActionSchema,
  v2FactReferenceSchema,
  v2JobSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
  v2UserMessageSchema,
  v2WorkspaceSchema,
} from "../../contracts/v2";
import { ApiError } from "./errors";
import { createFilesApi } from "./files";
import type { ActionView, CaseView, MessageView, TimelineView, WorkspaceView } from "./types";

/** Shared transport returns a Response for both mock and same-origin real requests. */
export type WorkspaceTransport = (path: string, init?: RequestInit) => Promise<Response>;
export function workspaceError(code: ApiError["code"], message: string, retryable = false) {
  return new ApiError(code, message, retryable);
}
export async function workspaceResponse(response: Response) {
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as {
      error?: { code?: string; retryable?: boolean };
    } | null;
    const wireCode = value?.error?.code;
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : wireCode === "CONSENT_REQUIRED"
          ? "CONSENT_REQUIRED"
          : response.status === 404 || wireCode === "ROLE_REQUIRED"
            ? "NOT_FOUND"
            : response.status === 409
              ? "CONFLICT"
              : response.status === 429
                ? "QUOTA_EXCEEDED"
                : response.status === 400 || response.status === 413
                  ? "VALIDATION_ERROR"
                  : "UNAVAILABLE";
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "로그인한 뒤 사건을 이어서 확인해 주세요.",
      CONSENT_REQUIRED: "최신 동의 내용을 확인해 주세요.",
      NOT_FOUND: "사건 또는 자료를 찾을 수 없어요.",
      CONFLICT: "다른 화면에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.",
      QUOTA_EXCEEDED: "사용 한도에 도달했어요. 저장된 내용은 보존됩니다.",
      VALIDATION_ERROR: "입력 또는 파일 형식·크기를 확인해 주세요.",
      UNAVAILABLE: "지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
    };
    throw workspaceError(
      code,
      messages[code] ?? "지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
      value?.error?.retryable === true || response.status >= 500,
    );
  }
  return response;
}
export async function workspaceJson(
  request: WorkspaceTransport,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await workspaceResponse(await request(path, init));
  const key = new Headers(init?.headers).get("idempotency-key");
  const value = await response.json();
  if (key)
    for (const [signature, value] of signatures) if (value === key) signatures.delete(signature);
  return value;
}
const signatures = new Map<string, string>();
export function workspaceMutation(path: string, body: unknown, method = "POST"): RequestInit {
  const signature = JSON.stringify({ path, body, method });
  const key = signatures.get(signature) ?? crypto.randomUUID();
  signatures.set(signature, key);
  if (signatures.size > 100) signatures.delete(signatures.keys().next().value ?? "");
  return {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  };
}
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
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["uploading", "processing", "ready", "failed", "waiting"]),
  coverage: z.string(),
  extractedText: z.string(),
  canStartProcessing: z.boolean().optional(),
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
export function createWorkspaceApi(
  request: WorkspaceTransport,
  jobStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
) {
  let storage = jobStorage;
  if (storage === undefined) {
    try {
      storage = typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
      storage = null;
    }
  }
  const files = createFilesApi(request);
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
  function rememberJob(id: string, jobId: string | null) {
    if (jobId) knownJobs.set(id, jobId);
    else knownJobs.delete(id);
    try {
      // Only an opaque resource ID is retained; no message, case facts or auth token.
      if (jobId) storage?.setItem(`baro-workspace-job:${id}`, jobId);
      else storage?.removeItem(`baro-workspace-job:${id}`);
    } catch {
      /* The current page still keeps the job when storage is unavailable. */
    }
  }
  function rememberedJob(id: string) {
    if (knownJobs.has(id)) return knownJobs.get(id) ?? null;
    try {
      const parsed = opaqueIdSchema.safeParse(storage?.getItem(`baro-workspace-job:${id}`));
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
    const cached = snapshots.get(id);
    const limits = historyLimits.get(id) ?? { messages: 500, actions: 1000, timeline: 1000 };
    const [intake, messagesRaw, actionsRaw, timelineRaw, fileViews] = await Promise.all([
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.intake)
        : workspaceJson(request, `${base(id)}/intake`),
      cached?.revision === w.workspaceRevision
        ? more === "messages"
          ? extendPage(cached.messagesRaw, (cursor) => allMessages(id, cursor))
          : Promise.resolve(cached.messagesRaw)
        : allMessages(id, null, limits.messages),
      cached?.revision === w.workspaceRevision
        ? more === "actions"
          ? extendPage(cached.actionsRaw, (cursor) => allEntities(id, "actions", cursor))
          : Promise.resolve(cached.actionsRaw)
        : allEntities(id, "actions", null, limits.actions),
      cached?.revision === w.workspaceRevision
        ? more === "timeline"
          ? extendPage(cached.timelineRaw, (cursor) => allEntities(id, "timeline", cursor))
          : Promise.resolve(cached.timelineRaw)
        : allEntities(id, "timeline", null, limits.timeline),
      files.list(id),
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
    const settled =
      cached?.revision === w.workspaceRevision && !more
        ? w
        : v2WorkspaceSchema.parse(await workspaceJson(request, `${base(id)}/workspace`));
    if (settled.workspaceRevision !== w.workspaceRevision) {
      snapshots.delete(id);
      if (recovery < 2) return get(id, recovery + 1);
      throw workspaceError("UNAVAILABLE", "사건이 갱신되어 최신 내용을 다시 불러와 주세요.", true);
    }
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
          : {}),
      }));
    let jobId = w.currentJobId ?? rememberedJob(id);
    let latestJob: z.infer<typeof v2JobSchema> | null = null;
    if (!w.currentJobId) {
      const latest = await request(`${base(id)}/workspace-jobs/latest`);
      if (latest.status !== 404) {
        latestJob = v2JobSchema.nullable().parse(await (await workspaceResponse(latest)).json());
        jobId = latestJob?.id ?? null;
        if (!jobId) rememberJob(id, null);
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
        rememberJob(id, null);
      if (
        job &&
        job.kind === "chat_response" &&
        job.target.kind === "workspace" &&
        job.target.caseId === id &&
        ["queued", "running", "validating", "failed"].includes(job.status)
      ) {
        rememberJob(id, job.id);
        const messageId = `job:${job.id}`;
        messageJobs.set(messageId, { jobId: job.id, revision: w.workspaceRevision });
        messages.push({
          id: messageId,
          role: "assistant",
          text:
            job.status === "failed"
              ? "응답을 완료하지 못했어요."
              : "추가된 내용을 정리하고 있어요.",
          status: job.status === "failed" ? "failed" : "pending",
          retryable:
            job.status === "failed" &&
            job.retryable &&
            job.failure !== "POLICY_REJECTED" &&
            job.attempts < 10,
          createdAt: job.updatedAt,
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
    const actions = actionsRaw.items.map((a) => {
      const item = v2ActionSchema.parse(a);
      actionRevisions.set(`${id}:${item.id}`, item.revision);
      return {
        id: item.id,
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
      title: metadata.narrative.slice(0, 60) || w.title,
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
    await workspaceJson(
      request,
      `${base(id)}/${path}`,
      workspaceMutation(`${base(id)}/${path}`, body, method),
    );
    return get(id);
  }
  return {
    get,
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
      const init = pendingMessages.get(signature) ?? workspaceMutation(path, input);
      pendingMessages.set(signature, init);
      const value = await workspaceJson(request, path, init);
      const accepted = v2AcceptedOperationSchema.safeParse(value);
      if (accepted.success) rememberJob(id, accepted.data.jobId);
      const next = await get(id);
      pendingMessages.delete(signature);
      return next;
    },
    async retryMessage(id: string, messageId: string) {
      // mock has the same request route; real recovers current failed job after reload.
      if (!messageJobs.has(messageId)) await get(id);
      const job = messageJobs.get(messageId);
      const path = job
        ? `workspace-jobs/${encodeURIComponent(job.jobId)}/retry`
        : `messages/${encodeURIComponent(messageId)}/retry`;
      if (job) {
        const accepted = v2AcceptedOperationSchema.parse(
          await workspaceJson(
            request,
            `${base(id)}/${path}`,
            workspaceMutation(`${base(id)}/${path}`, { expectedRevision: job.revision }),
          ),
        );
        rememberJob(id, accepted.jobId);
      } else return mutation(id, path, {});
      return get(id);
    },
    async setAction(id: string, actionId: string, done: boolean) {
      if (!actionRevisions.has(`${id}:${actionId}`)) await get(id);
      const route = `${base(id)}/actions/${encodeURIComponent(actionId)}`;
      const signature = JSON.stringify({ id, actionId });
      const pending = pendingActions.get(signature);
      const init =
        pending?.done === done
          ? pending.init
          : workspaceMutation(
              route,
              {
                expectedRevision: actionRevisions.get(`${id}:${actionId}`) ?? 1,
                status: done ? "done" : "todo",
              },
              "PUT",
            );
      pendingActions.set(signature, { done, init });
      try {
        await workspaceJson(request, route, init);
      } catch (cause) {
        if (
          (cause as { code?: string }).code === "CONFLICT" &&
          pendingActions.get(signature)?.init === init
        )
          pendingActions.delete(signature);
        throw cause;
      }
      const next = await get(id);
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
        init = workspaceMutation(route, body, entry.id ? "PUT" : "POST");
        pendingTimelines.set(signature, init);
      }
      try {
        await workspaceJson(request, route, init);
      } catch (cause) {
        if (
          (cause as { code?: string }).code === "CONFLICT" &&
          pendingTimelines.get(signature) === init
        )
          pendingTimelines.delete(signature);
        throw cause;
      }
      const next = await get(id);
      pendingTimelines.delete(signature);
      return next;
    },
  };
}
