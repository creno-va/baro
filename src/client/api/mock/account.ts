import type { DomainRequest } from "../reports";
import type { UsageView } from "../types";
import {
  mockResponseError,
  ReportMockError,
  type ReportMockRuntime,
  type ReportMockState,
  requireMockAccount,
  requireMockCase,
} from "./reports";
export type AccountMockRuntime = Omit<ReportMockRuntime, "original"> & {
  removeOriginals?: (ownerId: string, caseId?: string) => Promise<void>;
};
function eraseCase(state: ReportMockState, id: string) {
  delete state.cases[id];
  delete state.workspace[id];
  delete state.files[id];
  delete state.reports[id];
  for (const [reportId, report] of Object.entries(state.reportHistory ?? {}))
    if (report.caseId === id) {
      delete state.reportHistory?.[reportId];
      delete state.reportSources?.[reportId];
    }
  for (const [key, replay] of Object.entries(state.reportRequests ?? {}))
    if (replay.value.caseId === id) delete state.reportRequests?.[key];
  state.deletedCaseIds ??= [];
  state.deletedCaseIds.push(id);
}
export function createAccountMockHandler(runtime: AccountMockRuntime): DomainRequest {
  const handler: DomainRequest = async <T>(path, init = {}) => {
    const state = runtime.read();
    requireMockAccount(state);
    const method = init.method ?? "GET";
    if (path === "/api/v2/me/usage" && method === "GET") {
      const usage: UsageView = {
        newCases: { used: Object.keys(state.cases).length, limit: 3 },
        aiResponses: {
          used: Object.values(state.workspace).reduce(
            (count, workspace) =>
              count +
              (workspace.messages ?? []).filter((message) => message.role === "assistant").length,
            0,
          ),
          limit: 30,
        },
        mediaMinutes: { used: 0, limit: 60 },
        storageBytes: {
          used: Object.values(state.files)
            .flat()
            .reduce((size, file) => size + file.sizeBytes, 0),
          limit: 10_000_000_000,
        },
      };
      return usage as T;
    }
    if (path === "/api/me/deletion" && method === "GET")
      return {
        ownerTag: state.session.user?.id,
        recentOAuth: true,
        authenticatedAt: new Date().toISOString(),
        providers: ["google", "naver", "kakao"],
        mock: true,
      } as T;
    const casePath = path.match(/^\/api\/cases\/([^/]+)$/);
    if (casePath && method === "DELETE") {
      const id = decodeURIComponent(casePath[1] ?? "");
      requireMockCase(state, id);
      runtime.update((current) => {
        requireMockCase(current, id);
        eraseCase(current, id);
      });
      await runtime.removeOriginals?.(state.session.user?.id ?? "", id);
      return undefined as T;
    }
    if (path === "/api/me" && method === "DELETE") {
      if ((init.body as { confirmation?: string })?.confirmation !== "DELETE")
        throw new ReportMockError("VALIDATION_ERROR", "삭제 확인란에 DELETE를 입력해 주세요.");
      runtime.update((current) => {
        requireMockAccount(current);
        for (const id of Object.keys(current.cases)) eraseCase(current, id);
        // Clear every domain, including profile/session. Keep a tombstone rather than reseeding on reload.
        for (const key of Object.keys(current))
          delete (current as unknown as Record<string, unknown>)[key];
        Object.assign(current, {
          session: { user: null, needsConsent: false },
          cases: {},
          workspace: {},
          files: {},
          reports: {},
          reportHistory: {},
          reportSources: {},
          accountDeleted: true,
        });
      });
      await runtime.removeOriginals?.(state.session.user?.id ?? "");
      return { status: "accepted" } as T;
    }
    throw new ReportMockError("NOT_FOUND", "계정 요청 경로를 확인해 주세요.");
  };
  return handler;
}

export function createAccountMock(runtime: AccountMockRuntime) {
  const handle = createAccountMockHandler(runtime);
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (
      !["/api/v2/me/usage", "/api/me/deletion", "/api/me"].includes(path) &&
      !/^\/api\/cases\/[^/]+$/.test(path)
    )
      return null;
    if (path === "/api/me" && request.method !== "DELETE") return null;
    if (/^\/api\/cases\/[^/]+$/.test(path) && request.method !== "DELETE") return null;
    try {
      const result = await handle(path, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        ...(path === "/api/me" && request.method === "DELETE"
          ? { body: await request.json() }
          : {}),
      });
      return result === undefined
        ? new Response(null, { status: 204 })
        : Response.json(result, { status: path === "/api/me" ? 202 : 200 });
    } catch (error) {
      return mockResponseError(error);
    }
  };
}
