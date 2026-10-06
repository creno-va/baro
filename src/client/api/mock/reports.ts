import {
  createSyntheticPdf,
  createZip,
  maskReportText,
} from "../../../components/reports/download";
import type { DomainRequest, DomainRequestInit } from "../reports";
import { reportSaveSchema } from "../reports";
import type { CaseView, FileView, ReportView, SessionView, WorkspaceView } from "../types";

export type ReportMockState = {
  session: SessionView;
  cases: Record<string, CaseView>;
  caseOwners?: Record<string, string>;
  consents?: Record<string, unknown>;
  intake?: Record<string, unknown>;
  caseRequests?: Record<string, { ownerId: string; fingerprint: string; result: unknown }>;
  lawyers?: unknown;
  deletedAccountIds?: string[];
  workspace: Record<string, Partial<WorkspaceView>>;
  files: Record<string, FileView[]>;
  reports: Record<string, ReportView>;
  reportHistory?: Record<string, ReportView>;
  reportSources?: Record<string, number>;
  deletedCaseIds?: string[];
  reportRequests?: Record<string, { fingerprint: string; value: ReportView }>;
  workspaceReceipts?: Record<string, unknown>;
  fileProcessing?: Record<string, unknown>;
  fileExtractions?: Record<string, string>;
  fileUploads?: Record<string, { caseId: string; ownerId: string }>;
  fileUploadReceipts?: Record<string, { fileId: string; fingerprint: string }>;
};
export type ReportMockRuntime = {
  read: () => ReportMockState;
  update: (action: (state: ReportMockState) => void) => void;
  original: (caseId: string, fileId: string) => Promise<Blob>;
};
export class ReportMockError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function requireMockSession(state: ReportMockState) {
  if (!state.session.user || state.deletedAccountIds?.includes(state.session.user.id))
    throw new ReportMockError("UNAUTHENTICATED", "로그인이 필요해요.");
}
export function requireMockAccount(state: ReportMockState) {
  requireMockSession(state);
  if (state.session.needsConsent)
    throw new ReportMockError("CONSENT_REQUIRED", "먼저 필수 동의를 확인해 주세요.");
}
export function requireMockCase(state: ReportMockState, id: string, consent = true) {
  if (consent) requireMockAccount(state);
  else requireMockSession(state);
  if (state.session.user?.accountType !== "customer")
    throw new ReportMockError("ROLE_REQUIRED", "고객 역할로 로그인한 뒤 사건을 확인해 주세요.");
  const item = state.cases[id];
  if (
    !item ||
    state.deletedCaseIds?.includes(id) ||
    (state.caseOwners && state.caseOwners[id] !== state.session.user?.id)
  )
    throw new ReportMockError(
      "NOT_FOUND",
      "사건을 찾을 수 없어요. 삭제했거나 접근할 수 없는 사건이에요.",
    );
  return item;
}
function draft(state: ReportMockState, item: CaseView, revision: number): ReportView {
  const files = state.files[item.id] ?? [];
  const workspace = state.workspace[item.id];
  const content = [
    "[합성 API 예시 · 실제 AI/외부 처리 결과가 아닙니다]",
    "",
    "사건의 사실과 주장",
    item.summary || "아직 확인된 사건 요약이 없습니다. 내용을 직접 입력해 주세요.",
    "",
    "미확인·상반되는 내용",
    "상대방의 입장과 원본의 진정성은 확인되지 않았습니다. 날짜·금액·출처와 빠진 내용을 직접 확인하세요.",
    "",
    "타임라인",
    ...(workspace?.timeline ?? []).map(
      (entry) => `${entry.date} · ${entry.title}: ${entry.detail}`,
    ),
    "",
    "준비할 자료와 처리 범위",
    ...files.map((file) => `${file.name} · ${file.coverage || "처리 범위를 직접 확인하세요."}`),
    "",
    "연락과 전달",
    "사용자가 검토한 자료를 선택한 변호사에게 직접 전달합니다. 법률 판단·소송 전략이나 결과를 보장하지 않습니다.",
  ]
    .join("\n")
    .slice(0, 30000);
  return {
    id: `report-${crypto.randomUUID()}`,
    caseId: item.id,
    revision,
    title: item.title,
    content,
    updatedAt: new Date().toISOString(),
    stale: false,
    excludedFileIds: [],
    maskIdentifiers: false,
  };
}
export function createReportsMockHandler(runtime: ReportMockRuntime): DomainRequest {
  const handler: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    const state = runtime.read();
    requireMockAccount(state);
    if (state.session.user?.accountType !== "customer")
      throw new ReportMockError("ROLE_REQUIRED", "고객 역할로 로그인한 뒤 리포트를 확인해 주세요.");
    const reportPath = path.match(/^\/api\/v2\/cases\/([^/]+)\/reports$/);
    const exportPath = path.match(/^\/api\/v2\/reports\/([^/]+)\/(pdf|zip)$/);
    const method = init.method ?? "GET";
    const key = init.headers?.["idempotency-key"];
    const fingerprint = JSON.stringify([path, method, init.body]);
    if (reportPath) requireMockCase(state, decodeURIComponent(reportPath[1] ?? ""));
    if (key && state.reportRequests?.[key]) {
      const prior = state.reportRequests[key];
      if (prior.fingerprint !== fingerprint)
        throw new ReportMockError("CONFLICT", "다른 요청에 사용된 작업 키예요.");
      return structuredClone(prior.value) as T;
    }
    if (reportPath) {
      const id = decodeURIComponent(reportPath[1] ?? "");
      requireMockCase(state, id);
      let value: ReportView;
      if (method === "GET") {
        if (!state.reports[id])
          runtime.update((current) => {
            const item = requireMockCase(current, id);
            const report = draft(current, item, 1);
            current.reports[id] = report;
            current.reportHistory ??= {};
            current.reportHistory[report.id] = structuredClone(report);
            current.reportSources ??= {};
            current.reportSources[report.id] = item.revision;
          });
        const current = runtime.read();
        value = structuredClone(current.reports[id] as ReportView);
        value.stale =
          (current.reportSources?.[value.id] ?? current.cases[id]?.revision) !==
          current.cases[id]?.revision;
      } else if (method === "PATCH" || method === "POST") {
        const body = init.body as { expectedRevision?: number };
        runtime.update((current) => {
          const item = requireMockCase(current, id);
          const prior = current.reports[id];
          if (prior && body?.expectedRevision !== prior.revision)
            throw new ReportMockError(
              "CONFLICT",
              "다른 화면에서 리포트가 변경됐어요. 다시 확인한 뒤 저장해 주세요.",
            );
          if (method === "POST") {
            const next = draft(current, item, (prior?.revision ?? 0) + 1);
            current.reports[id] = next;
            current.reportHistory ??= {};
            current.reportHistory[next.id] = structuredClone(next);
            current.reportSources ??= {};
            current.reportSources[next.id] = item.revision;
          } else {
            if (!prior) throw new ReportMockError("NOT_FOUND", "먼저 리포트를 확인해 주세요.");
            const input = reportSaveSchema.parse(body);
            const allowed = new Set((current.files[id] ?? []).map((file) => file.id));
            if (input.excludedFileIds.some((fileId) => !allowed.has(fileId)))
              throw new ReportMockError("VALIDATION_ERROR", "제외할 자료를 다시 확인해 주세요.");
            const next = {
              ...prior,
              ...input,
              id: `report-${crypto.randomUUID()}`,
              revision: prior.revision + 1,
              updatedAt: new Date().toISOString(),
              stale: false,
            };
            current.reports[id] = next;
            current.reportHistory ??= {};
            current.reportHistory[next.id] = structuredClone(next);
            current.reportSources ??= {};
            current.reportSources[next.id] = item.revision;
          }
        });
        value = structuredClone(runtime.read().reports[id] as ReportView);
      } else throw new ReportMockError("NOT_FOUND", "요청한 기능을 찾을 수 없어요.");
      if (key)
        runtime.update((current) => {
          requireMockCase(current, id);
          current.reportRequests ??= {};
          current.reportRequests[key] = { fingerprint, value: structuredClone(value) };
          const keys = Object.keys(current.reportRequests);
          if (keys.length > 100) delete current.reportRequests[keys[0] ?? ""];
        });
      return value as T;
    }
    if (exportPath) {
      const id = decodeURIComponent(exportPath[1] ?? "");
      const report =
        state.reportHistory?.[id] ?? Object.values(state.reports).find((item) => item.id === id);
      if (!report) throw new ReportMockError("NOT_FOUND", "리포트를 찾을 수 없어요.");
      requireMockCase(state, report.caseId);
      const content = report.maskIdentifiers ? maskReportText(report.content) : report.content;
      if (exportPath[2] === "pdf" && method === "GET") {
        const blob = await createSyntheticPdf(report.title, content, report.revision);
        const latest = runtime.read();
        requireMockCase(latest, report.caseId);
        if (latest.session.user?.id !== state.session.user?.id)
          throw new ReportMockError(
            "UNAUTHENTICATED",
            "로그인 상태가 변경됐어요. 다시 확인해 주세요.",
          );
        return blob as T;
      }
      if (exportPath[2] === "zip" && method === "POST") {
        const ids = (init.body as { selectedFileIds?: unknown })?.selectedFileIds;
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 100 ||
          new Set(ids).size !== ids.length
        )
          throw new ReportMockError("VALIDATION_ERROR", "원본 자료를 1~100개 선택해 주세요.");
        const materials = state.files[report.caseId] ?? [];
        const entries: { name: string; blob: Blob }[] = [];
        for (const fileId of ids) {
          const file = materials.find((item) => item.id === fileId);
          if (file?.status !== "ready" || report.excludedFileIds.includes(file.id))
            throw new ReportMockError(
              "VALIDATION_ERROR",
              "삭제·제외·처리 중인 자료를 내보낼 수 없어요.",
            );
          entries.push({ name: file.name, blob: await runtime.original(report.caseId, file.id) });
        }
        const latest = runtime.read();
        requireMockCase(latest, report.caseId);
        if (
          ids.some(
            (fileId) => !(latest.files[report.caseId] ?? []).some((file) => file.id === fileId),
          )
        )
          throw new ReportMockError("NOT_FOUND", "내보내는 동안 자료가 삭제됐어요.");
        const blob = await createZip(entries);
        const finalState = runtime.read();
        requireMockCase(finalState, report.caseId);
        if (
          finalState.session.user?.id !== state.session.user?.id ||
          ids.some(
            (fileId) => !(finalState.files[report.caseId] ?? []).some((file) => file.id === fileId),
          )
        )
          throw new ReportMockError("NOT_FOUND", "내보내는 동안 자료나 로그인 상태가 변경됐어요.");
        return blob as T;
      }
    }
    throw new ReportMockError("NOT_FOUND", "리포트 요청 경로를 확인해 주세요.");
  };
  return handler;
}

export function mockResponseError(error: unknown) {
  const known = error instanceof ReportMockError;
  const code = known ? error.code : "VALIDATION_ERROR";
  const status =
    code === "UNAUTHENTICATED"
      ? 401
      : ["CONSENT_REQUIRED", "ROLE_REQUIRED", "REAUTHENTICATION_REQUIRED"].includes(code)
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : code === "CONFLICT"
            ? 409
            : 400;
  return Response.json(
    {
      error: {
        code,
        message: known ? error.message : "입력 내용을 다시 확인해 주세요.",
        retryable: known && error.retryable,
      },
    },
    { status },
  );
}
export function createReportsMock(runtime: ReportMockRuntime) {
  const handle = createReportsMockHandler(runtime);
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (!/^\/api\/v2\/(cases\/[^/]+\/reports|reports\/[^/]+\/(pdf|zip))$/.test(path)) return null;
    try {
      const result = await handle(path, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        ...(request.method !== "GET" ? { body: await request.json() } : {}),
      });
      return result instanceof Blob
        ? new Response(result, { headers: { "content-type": result.type } })
        : Response.json(result);
    } catch (error) {
      return mockResponseError(error);
    }
  };
}
