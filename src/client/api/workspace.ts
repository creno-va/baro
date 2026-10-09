import { z } from "zod";
import { caseDetailResponseSchema, opaqueIdSchema } from "../../contracts";
import {
  v2AcceptedOperationSchema,
  v2ActionSchema,
  v2JobSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
  v2UserMessageSchema,
  v2WorkspaceSchema,
} from "../../contracts/v2";
import { createFilesApi } from "./files";
import type { ActionView, CaseView, MessageView, TimelineView, WorkspaceView } from "./types";

/** Shared transport returns a Response for both mock and same-origin real requests. */
export type WorkspaceTransport = (path: string, init?: RequestInit) => Promise<Response>;
export function workspaceError(code: string, message: string, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
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
const fileViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["uploading", "processing", "ready", "failed", "waiting"]),
  coverage: z.string(),
  extractedText: z.string(),
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
      createdAt: z.string(),
    }),
  ),
  actions: z.array(
    z.object({ id: z.string(), title: z.string(), detail: z.string(), done: z.boolean() }),
  ),
  timeline: z.array(
    z.object({ id: z.string(), date: z.string(), title: z.string(), detail: z.string() }),
  ),
  files: z.array(fileViewSchema),
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
      actionsRaw: unknown[];
      timelineRaw: unknown[];
      summary: z.infer<typeof v2SummarySchema> | null;
    }
  >();
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
  // This screen renders plain message text. Source validation and URL allowlists stay
  // on the server; hidden citations must not be revalidated against an empty registry.
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
    }),
  ]);
  async function get(id: string): Promise<CustomerWorkspaceView> {
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
    const [intake, messagesRaw, actionsRaw, timelineRaw, fileViews] = await Promise.all([
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.intake)
        : workspaceJson(request, `${base(id)}/intake`),
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.messagesRaw)
        : allMessages(id),
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.actionsRaw)
        : allEntities(id, "actions"),
      cached?.revision === w.workspaceRevision
        ? Promise.resolve(cached.timelineRaw)
        : allEntities(id, "timeline"),
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
    snapshots.set(id, {
      revision: w.workspaceRevision,
      intake,
      messagesRaw,
      actionsRaw,
      timelineRaw,
      summary,
    });
    if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value ?? "");
    const messages: MessageView[] = messagesRaw.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      status: "complete",
      createdAt: m.createdAt,
    }));
    let jobId = w.currentJobId ?? rememberedJob(id);
    if (!jobId) {
      const latest = await request(`${base(id)}/workspace-jobs/latest`);
      if (latest.status !== 404) {
        const recovered = v2JobSchema
          .nullable()
          .parse(await (await workspaceResponse(latest)).json());
        if (recovered && ["queued", "running", "validating", "failed"].includes(recovered.status))
          jobId = recovered.id;
      }
    }
    if (jobId) {
      const response = await request(`${base(id)}/workspace-jobs/${encodeURIComponent(jobId)}`);
      const job =
        response.status === 404 && !w.currentJobId
          ? null
          : v2JobSchema.parse(await (await workspaceResponse(response)).json());
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
          createdAt: job.updatedAt,
        });
      }
    }
    const actions = actionsRaw.map((a) => {
      const item = v2ActionSchema.parse(a);
      actionRevisions.set(`${id}:${item.id}`, item.revision);
      return {
        id: item.id,
        title: item.title,
        detail: `${item.instructions}\n${item.caution}`,
        done: item.status === "done",
      } satisfies ActionView;
    });
    const timeline = timelineRaw.map((t) => {
      const item = v2TimelineEntrySchema.parse(t);
      timelineRevisions.set(`${id}:${item.id}`, item.revision);
      const [title, ...detail] = item.event.split("\n");
      return {
        id: item.id,
        date: item.date ?? "",
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
  async function allMessages(id: string) {
    const items: z.infer<typeof messageTextSchema>[] = [];
    let cursor: string | null = null;
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
      if (items.length >= 500) break;
    } while (cursor);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async function allEntities(id: string, name: "actions" | "timeline") {
    const items: unknown[] = [];
    let cursor: string | null = null;
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
      if (items.length >= 1000) break;
    } while (cursor);
    return items;
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
    async saveTimeline(id: string, entry: Omit<TimelineView, "id"> & { id?: string }) {
      if (entry.id && !timelineRevisions.has(`${id}:${entry.id}`)) await get(id);
      const route = `${base(id)}/timeline${entry.id ? `/${encodeURIComponent(entry.id)}` : ""}`;
      const signature = JSON.stringify({ id, entry });
      let init = pendingTimelines.get(signature);
      if (!init) {
        const body = {
          expectedRevision: entry.id
            ? (timelineRevisions.get(`${id}:${entry.id}`) ?? 1)
            : (workspaceRevisions.get(id) ?? (await get(id)).case.revision),
          date: entry.date || null,
          datePrecision: entry.date ? "day" : "unknown",
          event: entry.detail ? `${entry.title}\n${entry.detail}` : entry.title,
        };
        init = workspaceMutation(route, body, entry.id ? "PUT" : "POST");
        pendingTimelines.set(signature, init);
      }
      await workspaceJson(request, route, init);
      const next = await get(id);
      pendingTimelines.delete(signature);
      return next;
    },
  };
}
