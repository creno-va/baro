import type { DomainRequest, DomainRequestInit } from "../reports";
import type { UsageView } from "../types";
import {
  mockResponseError,
  ReportMockError,
  type ReportMockRuntime,
  type ReportMockState,
  requireMockAccount,
  requireMockCase,
  requireMockSession,
} from "./reports";
export type AccountMockRuntime = Omit<ReportMockRuntime, "original"> & {
  removeOriginals?: (ownerId: string, caseId?: string) => Promise<void>;
};
function eraseCase(state: ReportMockState, id: string) {
  const fileIds = new Set((state.files[id] ?? []).map((file) => file.id));
  for (const [fileId, upload] of Object.entries(state.fileUploads ?? {}))
    if (upload.caseId === id) fileIds.add(fileId);
  for (const fileId of fileIds) {
    delete state.fileProcessing?.[fileId];
    delete state.fileExtractions?.[fileId];
    delete state.fileUploads?.[fileId];
    delete state.fileReviews?.[fileId];
  }
  for (const [key, receipt] of Object.entries(state.fileReviewReceipts ?? {}))
    if (fileIds.has(receipt.value.fileId)) delete state.fileReviewReceipts?.[key];
  for (const [key, receipt] of Object.entries(state.fileUploadReceipts ?? {}))
    if (fileIds.has(receipt.fileId) || key.startsWith(`${state.session.user?.id}/${id}/`))
      delete state.fileUploadReceipts?.[key];
  for (const key of Object.keys(state.workspaceReceipts ?? {}))
    if (key.includes(`:/api/v2/cases/${encodeURIComponent(id)}/`))
      delete state.workspaceReceipts?.[key];
  delete state.intake?.[id];
  delete state.caseOwners?.[id];
  for (const [key, receipt] of Object.entries(state.caseRequests ?? {})) {
    let input: { id?: string } = {};
    try {
      input = JSON.parse(receipt.fingerprint);
    } catch {
      /* Malformed receipt has no trusted case identity. */
    }
    if (input?.id === id || (receipt.result as { id?: string } | null)?.id === id)
      delete state.caseRequests?.[key];
  }
  delete state.cases[id];
  delete state.workspace[id];
  delete state.files[id];
  delete state.reports[id];
  for (const [reportId, report] of Object.entries(state.reportHistory ?? {}))
    if (report.caseId === id) {
      delete state.reportHistory?.[reportId];
      delete state.reportSources?.[reportId];
    }
  for (const [archiveId, archive] of Object.entries(state.reportZips ?? {}))
    if (archive.caseId === id) delete state.reportZips?.[archiveId];
  for (const [key, replay] of Object.entries(state.reportRequests ?? {}))
    if (replay.value.caseId === id) delete state.reportRequests?.[key];
  state.deletedCaseIds ??= [];
  state.deletedCaseIds.push(id);
}
export function createAccountMockHandler(runtime: AccountMockRuntime): DomainRequest {
  const handler: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    const state = runtime.read();
    requireMockSession(state);
    const ownerId = state.session.user?.id ?? "";
    const sameOwner = (current: ReportMockState) => {
      requireMockSession(current);
      if (current.session.user?.id !== ownerId)
        throw new ReportMockError(
          "UNAUTHENTICATED",
          "로그인 상태가 변경됐어요. 다시 확인해 주세요.",
        );
    };
    const method = init.method ?? "GET";
    if (path === "/api/v2/me/usage" && method === "GET") {
      requireMockAccount(state);
      const caseIds = Object.keys(state.cases).filter(
        (id) => !state.caseOwners || state.caseOwners[id] === ownerId,
      );
      const usage: UsageView = {
        newCases: { used: caseIds.length, limit: 3 },
        aiResponses: {
          used: caseIds
            .map((id) => state.workspace[id] ?? {})
            .reduce(
              (count, workspace) =>
                count +
                (workspace.messages ?? []).filter((message) => message.role === "assistant").length,
              0,
            ),
          limit: 200,
        },
        mediaMinutes: { used: 0, limit: 60 },
        storageBytes: {
          used: caseIds
            .flatMap((id) => state.files[id] ?? [])
            .reduce((size, file) => size + file.sizeBytes, 0),
          limit: 10_000_000_000,
        },
      };
      return usage as T;
    }
    if (path === "/api/me/deletion" && method === "GET") {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`mock-owner:${state.session.user?.id}`),
      );
      return {
        ownerTag: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
        recentOAuth: true,
        authenticatedAt: new Date().toISOString(),
        providers: ["google", "naver", "kakao"],
        mock: true,
      } as T;
    }
    const casePath = path.match(/^\/api\/(?:v2\/)?cases\/([^/]+)$/);
    if (casePath && method === "DELETE") {
      const id = decodeURIComponent(casePath[1] ?? "");
      requireMockCase(state, id, false);
      await runtime.removeOriginals?.(ownerId, id);
      runtime.update((current) => {
        sameOwner(current);
        requireMockCase(current, id, false);
        eraseCase(current, id);
      });
      return undefined as T;
    }
    if (path === "/api/me" && method === "DELETE") {
      if ((init.body as { confirmation?: string })?.confirmation !== "DELETE")
        throw new ReportMockError("VALIDATION_ERROR", "삭제 확인란에 DELETE를 입력해 주세요.");
      await runtime.removeOriginals?.(ownerId);
      runtime.update((current) => {
        sameOwner(current);
        const hasOwners = Boolean(current.caseOwners);
        for (const id of Object.keys(current.cases))
          if (!current.caseOwners || current.caseOwners[id] === ownerId) eraseCase(current, id);
        if (hasOwners) {
          delete current.consents?.[ownerId];
          for (const [key, receipt] of Object.entries(current.caseRequests ?? {}))
            if (receipt.ownerId === ownerId) delete current.caseRequests?.[key];
          const lawyers = current.lawyers as
            | {
                profiles?: { id: string }[];
                owners?: Record<string, string>;
                assets?: Record<string, { ownerId: string; profileId?: string }>;
              }
            | undefined;
          const profileId = lawyers?.owners?.[ownerId];
          if (profileId && lawyers) {
            if (lawyers.profiles)
              lawyers.profiles = lawyers.profiles.filter((profile) => profile.id !== profileId);
            delete lawyers.owners?.[ownerId];
          }
          for (const [id, asset] of Object.entries(lawyers?.assets ?? {}))
            if (asset.ownerId === ownerId || (profileId && asset.profileId === profileId))
              delete lawyers?.assets?.[id];
          current.session = { user: null, needsConsent: false };
          current.deletedAccountIds = [...new Set([...(current.deletedAccountIds ?? []), ownerId])];
          return;
        }
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
      !/^\/api\/(?:v2\/)?cases\/[^/]+$/.test(path)
    )
      return null;
    if (path === "/api/me" && request.method !== "DELETE") return null;
    if (/^\/api\/(?:v2\/)?cases\/[^/]+$/.test(path) && request.method !== "DELETE") return null;
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
