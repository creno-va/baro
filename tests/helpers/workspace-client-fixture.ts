// Isolated browser contract harness: the product Workspace still imports the shared api facade.
// Only workspace.astro.config.ts aliases that import; no production route or fallback is added.
import { createFilesApi } from "../../src/client/api/files";
import { createFilesMock } from "../../src/client/api/mock/files";
import {
  createWorkspaceMock,
  type WorkspaceMockRuntime,
  type WorkspaceMockState,
} from "../../src/client/api/mock/workspace";
import { createWorkspaceApi } from "../../src/client/api/workspace";

const key = "baro-c-contract-test-state";
const initial: WorkspaceMockState = {
  session: {
    user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
    needsConsent: false,
  },
  cases: {
    "synthetic-case": {
      id: "synthetic-case",
      title: "대여금 반환 관련 자료 정리",
      subjectContext: "individual",
      stage: "active",
      revision: 1,
      updatedAt: "2026-10-06T00:00:00.000Z",
      summary:
        "친구에게 빌려준 금액과 반환 약속 날짜를 원본 자료로 확인하려고 합니다. 이 내용은 브라우저 검증용 합성 사건입니다.",
      schemaVersion: "2",
    },
  },
  workspace: {},
  files: {},
};
const runtime: WorkspaceMockRuntime = {
  read: () => JSON.parse(localStorage.getItem(key) ?? JSON.stringify(initial)),
  update: (action) => {
    const state = runtime.read();
    const result = action(state);
    localStorage.setItem(key, JSON.stringify(state));
    return result;
  },
};
const handlers = [createWorkspaceMock(runtime), createFilesMock(runtime)];
async function request(path: string, init?: RequestInit) {
  for (const handler of handlers) {
    const result = await handler(new Request(new URL(path, window.location.origin), init));
    if (result) return result;
  }
  return Response.json({ error: { code: "NOT_FOUND", retryable: false } }, { status: 404 });
}
export const api = { workspace: createWorkspaceApi(request), files: createFilesApi(request) };
