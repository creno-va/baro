import { ZodError } from "zod";
import {
  type V2UploadPart,
  type V2UploadSession,
  v2TimelineEditRequestSchema,
} from "../../../contracts/v2";
import type {
  ActionView,
  CaseView,
  FileView,
  MessageView,
  SessionView,
  TimelineView,
  WorkspaceView,
} from "../types";

export type WorkspaceMockData = {
  messages: MessageView[];
  actions: ActionView[];
  timeline: TimelineView[];
  pending?: Record<string, { at: number; failed: boolean }>;
};
export type WorkspaceMockState = {
  session: SessionView;
  cases: Record<string, CaseView>;
  caseOwners?: Record<string, string>;
  deletedAccountIds?: string[];
  workspace: Record<string, WorkspaceMockData>;
  files: Record<string, FileView[]>;
  deletedCaseIds?: string[];
  faults?: Record<string, string[]>;
  workspaceReceipts?: Record<string, unknown>;
  fileProcessing?: Record<string, { at: number; failed: boolean }>;
  fileExtractions?: Record<string, string>;
  fileUploads?: Record<
    string,
    {
      session: V2UploadSession;
      caseId: string;
      ownerId: string;
      parts: Record<number, V2UploadPart>;
      failedProcessing: boolean;
    }
  >;
  fileUploadReceipts?: Record<string, { fileId: string; fingerprint: string }>;
  reports?: Record<string, { stale: boolean; excludedFileIds: string[] }>;
  [namespace: string]: unknown;
};
export type WorkspaceMockRuntime = {
  read: () => WorkspaceMockState;
  update: <T>(mutate: (state: WorkspaceMockState) => T) => T;
};
export class WorkspaceMockError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function mockResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "x-baro-mock": "true" } });
}
export function mockFailure(cause: unknown) {
  const error =
    cause instanceof WorkspaceMockError
      ? cause
      : cause instanceof ZodError || cause instanceof SyntaxError
        ? new WorkspaceMockError("VALIDATION_ERROR", "입력 내용을 확인해 주세요.")
        : new WorkspaceMockError("UNAVAILABLE", "예시 응답을 저장하지 못했어요.", true);
  const status =
    error.code === "UNAUTHENTICATED"
      ? 401
      : error.code === "CONSENT_REQUIRED"
        ? 403
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : error.code === "QUOTA_EXCEEDED"
              ? 429
              : error.code === "VALIDATION_ERROR"
                ? 400
                : 503;
  return mockResponse(
    { error: { code: error.code, message: error.message, retryable: error.retryable } },
    status,
  );
}
export function requireMockCase(state: WorkspaceMockState, id: string, write = false) {
  if (!state.session.user) throw new WorkspaceMockError("UNAUTHENTICATED", "로그인이 필요해요.");
  if (state.deletedAccountIds?.includes(state.session.user.id))
    throw new WorkspaceMockError("UNAUTHENTICATED", "로그인이 필요해요.");
  if (write && state.session.needsConsent)
    throw new WorkspaceMockError("CONSENT_REQUIRED", "동의를 확인해 주세요.");
  const item = state.cases[id];
  if (
    !item ||
    state.deletedCaseIds?.includes(id) ||
    (state.caseOwners && state.caseOwners[id] !== state.session.user.id)
  )
    throw new WorkspaceMockError("NOT_FOUND", "사건을 찾을 수 없어요.");
  if (write && item.stage !== "active")
    throw new WorkspaceMockError("CONFLICT", "최신 요약을 확인하거나 보관 상태를 확인해 주세요.");
  return item;
}
export function mockFault(state: WorkspaceMockState, operation: string) {
  const code = state.faults?.[operation]?.shift();

  return code;
}
export function consumeMockFault(runtime: WorkspaceMockRuntime, operation: string) {
  const code = runtime.update((state) => mockFault(state, operation));
  if (code && code !== "chat_failed" && code !== "file_failed")
    throw new WorkspaceMockError(code, "요청을 처리할 수 없어요.", code === "UNAVAILABLE");
  return code;
}
export function touchMockCase(state: WorkspaceMockState, id: string) {
  const item = requireMockCase(state, id);
  item.revision++;
  item.updatedAt = new Date().toISOString();
  if (state.reports?.[id]) state.reports[id].stale = true;
}
export function ensureMockWorkspace(state: WorkspaceMockState, id: string) {
  const item = requireMockCase(state, id);
  state.workspace ??= {};
  state.files ??= {};
  state.workspace[id] ??= {
    messages: [],
    timeline: [],
    actions: [
      {
        id: crypto.randomUUID(),
        title: "자료 원본 보관하기",
        detail: "내용과 날짜를 확인할 수 있는 원본을 보관하고, 필요한 자료를 직접 선택하세요.",
        done: false,
      },
      {
        id: crypto.randomUUID(),
        title: "확인이 필요한 사실 정리하기",
        detail: "기억이 분명하지 않은 내용과 불리할 수 있는 사실도 구분해 두세요.",
        done: false,
      },
      {
        id: crypto.randomUUID(),
        title: "전문가와 확인할 질문 준비하기",
        detail: "리포트를 검토하고, 변호사를 직접 선택해 질문할 내용을 준비하세요.",
        done: false,
      },
    ],
  };
  state.files[id] ??= [];
  const data = state.workspace[id];
  let changed = false;
  for (const [messageId, pending] of Object.entries(data.pending ?? {})) {
    if (pending.at > Date.now()) continue;
    const message = data.messages.find((value) => value.id === messageId);
    if (message) {
      changed = true;
      message.status = pending.failed ? "failed" : "complete";
      message.text = pending.failed
        ? "예시 응답 생성에 실패했어요."
        : "추가한 내용을 저장했어요. 날짜·당사자·자료 원본을 확인하고, 불확실하거나 불리할 수 있는 사실도 함께 정리해 주세요. 이 응답은 합성 API 예시이며 실제 AI 분석이나 법률 판단이 아닙니다.";
    }
    delete data.pending?.[messageId];
  }
  for (const file of state.files[id]) {
    const pending = state.fileProcessing?.[file.id];
    if (pending && pending.at <= Date.now()) {
      changed = true;
      file.status = pending.failed ? "failed" : "ready";
      file.extractedText = pending.failed ? "" : (state.fileExtractions?.[file.id] ?? "");
      file.coverage = pending.failed
        ? "예시 처리 실패 · 추출 결과 없음"
        : "API 예시 처리 완료 · 실제 OCR·ASR·영상 처리는 수행되지 않았어요.";
      delete state.fileProcessing?.[file.id];
    }
  }
  if (changed) touchMockCase(state, id);
  return {
    case: item,
    messages: data.messages,
    actions: data.actions,
    timeline: data.timeline,
    files: state.files[id],
  } satisfies WorkspaceView;
}
function receiptKey(request: Request, body: unknown) {
  return `${request.method}:${new URL(request.url).pathname}:${request.headers.get("idempotency-key") ?? ""}:${JSON.stringify(body)}`;
}
export function createWorkspaceMock(runtime: WorkspaceMockRuntime) {
  return async function handleWorkspaceMock(request: Request): Promise<Response | null> {
    if (/^\/api\/cases\/[^/]+$/.test(new URL(request.url).pathname))
      return mockFailure(new WorkspaceMockError("NOT_FOUND", "기존 사건을 찾을 수 없어요."));
    const match =
      /^\/api\/v2\/cases\/([^/]+)\/(workspace|messages(?:\/([^/]+)\/retry)?|actions\/([^/]+)|timeline(?:\/([^/]+))?)$/.exec(
        new URL(request.url).pathname,
      );
    if (!match) return null;
    const id = decodeURIComponent(match[1] ?? "");
    const route = match[2];
    try {
      const body =
        request.method === "GET" ? {} : ((await request.json()) as Record<string, unknown>);
      requireMockCase(runtime.read(), id, request.method !== "GET");
      const key = receiptKey(request, body);
      const replay = runtime.read().workspaceReceipts?.[key];
      if (request.method !== "GET" && replay) return mockResponse(replay);
      const operation =
        route === "workspace"
          ? "workspace.get"
          : route === "messages"
            ? "workspace.sendMessage"
            : match[3]
              ? "workspace.retryMessage"
              : match[4]
                ? "workspace.setAction"
                : "workspace.saveTimeline";
      const fault = consumeMockFault(runtime, operation);
      return runtime.update((state) => {
        requireMockCase(state, id, request.method !== "GET");
        const view = ensureMockWorkspace(state, id),
          data = state.workspace[id];
        if (!data) throw new WorkspaceMockError("NOT_FOUND", "작업 공간을 찾을 수 없어요.");
        if (route === "workspace" && request.method === "GET") {
          return mockResponse(view);
        }
        if (route === "messages" && request.method === "POST") {
          if (body.expectedRevision !== view.case.revision)
            throw new WorkspaceMockError("CONFLICT", "내용이 바뀌었어요.");
          if (
            typeof body.text !== "string" ||
            !body.text.trim() ||
            body.text.length > 10000 ||
            !Array.isArray(body.selectedFileIds) ||
            body.selectedFileIds.some(
              (fileId) => !view.files.some((file) => file.id === fileId && file.status === "ready"),
            )
          )
            throw new WorkspaceMockError("VALIDATION_ERROR", "질문과 선택 자료를 확인해 주세요.");
          const createdAt = new Date().toISOString(),
            assistantId = crypto.randomUUID();
          data.messages.push(
            {
              id: crypto.randomUUID(),
              role: "user",
              text: body.text.trim(),
              status: "complete",
              createdAt,
            },
            {
              id: assistantId,
              role: "assistant",
              text: "추가된 내용을 정리하고 있어요.",
              status: "pending",
              createdAt,
            },
          );
          data.pending ??= {};
          data.pending[assistantId] = { at: Date.now() + 1200, failed: fault === "chat_failed" };
          touchMockCase(state, id);
        } else if (match[3] && request.method === "POST") {
          const message = data.messages.find(
            (item) => item.id === decodeURIComponent(match[3] ?? ""),
          );
          if (message?.role !== "assistant" || message.status !== "failed")
            throw new WorkspaceMockError("CONFLICT", "실패한 응답만 다시 시도할 수 있어요.");
          message.status = "pending";
          message.text = "응답을 다시 준비하고 있어요.";
          data.pending ??= {};
          data.pending[message.id] = { at: Date.now() + 1000, failed: false };
          touchMockCase(state, id);
        } else if (match[4] && request.method === "PUT") {
          if (body.expectedRevision !== view.case.revision)
            throw new WorkspaceMockError("CONFLICT", "내용이 바뀌었어요.");
          const action = data.actions.find(
            (item) => item.id === decodeURIComponent(match[4] ?? ""),
          );
          if (!action) throw new WorkspaceMockError("NOT_FOUND", "행동을 찾을 수 없어요.");
          if (body.status !== "todo" && body.status !== "done")
            throw new WorkspaceMockError("VALIDATION_ERROR", "행동 상태를 확인해 주세요.");
          action.done = body.status === "done";
          touchMockCase(state, id);
        } else if (
          route?.startsWith("timeline") &&
          (request.method === "PUT" || request.method === "POST")
        ) {
          if (body.expectedRevision !== view.case.revision)
            throw new WorkspaceMockError("CONFLICT", "내용이 바뀌었어요.");
          if (
            typeof body.event !== "string" ||
            !body.event.trim() ||
            body.event.length > 2000 ||
            (body.date !== null &&
              (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)))
          )
            throw new WorkspaceMockError("VALIDATION_ERROR", "타임라인 입력을 확인해 주세요.");
          const timeline = v2TimelineEditRequestSchema.parse(body);
          const [title, ...detail] = body.event.split("\n");
          const entry = {
            id: match[5] ? decodeURIComponent(match[5]) : crypto.randomUUID(),
            date: typeof body.date === "string" ? body.date : "",
            datePrecision: timeline.datePrecision,
            title: title ?? "",
            detail: detail.join("\n"),
          };
          const index = data.timeline.findIndex((item) => item.id === entry.id);
          if (request.method === "PUT" && index < 0)
            throw new WorkspaceMockError("NOT_FOUND", "일정을 찾을 수 없어요.");
          if (index >= 0) data.timeline[index] = entry;
          else data.timeline.push(entry);
          touchMockCase(state, id);
        } else return mockResponse({ error: { code: "NOT_FOUND", retryable: false } }, 404);
        const result = structuredClone(ensureMockWorkspace(state, id));
        state.workspaceReceipts ??= {};
        state.workspaceReceipts[key] = result;
        return mockResponse(result);
      });
    } catch (cause) {
      return mockFailure(cause);
    }
  };
}
