// Browser-only test composition of the real D domain factories and mock handlers.
// Product code never imports this module. No fixture is imported into a product component.

import { createAccountClient } from "../../src/client/api/account";
import { createAccountMock } from "../../src/client/api/mock/account";
import { createReportsMock, type ReportMockState } from "../../src/client/api/mock/reports";
import { createReportsApi, domainRequest } from "../../src/client/api/reports";

const key = "baro.reports.browser-test.v1";
const realAccountKey = "baro.reports-test.real-account";
if (location.search.includes("real-account")) sessionStorage.setItem(realAccountKey, "true");
const initial: ReportMockState & { lawyers: unknown } = {
  session: {
    user: { id: "synthetic-owner", name: "합성 이용자", accountType: "customer" },
    needsConsent: false,
  },
  cases: {
    "case-demo": {
      id: "case-demo",
      title: "합성 대여금 사건",
      subjectContext: "individual",
      stage: "active",
      revision: 1,
      updatedAt: "2026-10-06T10:00:00.000Z",
      summary: "합성 사실: 010-1234-5678, demo@example.test",
    },
  },
  workspace: { "case-demo": { messages: [], timeline: [] } },
  files: {
    "case-demo": [
      {
        id: "file-demo",
        name: "합성 자료.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 25,
        status: "ready",
        coverage: "합성 텍스트 전체",
        extractedText: "합성 원본",
      },
    ],
  },
  reports: {},
  lawyers: { mine: { published: true } },
};
if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
function read(): ReportMockState {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : structuredClone(initial);
}
function update<T>(action: (state: ReportMockState) => T) {
  const value = read();
  const result = action(value);
  localStorage.setItem(key, JSON.stringify(value));
  return result;
}
const runtime = {
  read,
  update,
  original: async () => (await fetch("/synthetic-photo.jpg")).blob(),
};
const handleReports = createReportsMock(runtime),
  handleAccount = createAccountMock(runtime);
async function request(path: string, init?: RequestInit) {
  if (sessionStorage.getItem(realAccountKey) === "true") return fetch(path, init);
  const input = new Request(new URL(path, location.origin), init);
  const result = (await handleReports(input)) ?? (await handleAccount(input));
  if (!result) throw new Error("Unregistered test request");
  return result;
}
export const api = {
  session: { get: async () => read().session },
  reports: createReportsApi(request),
  account: createAccountClient(domainRequest(request), {
    // Only the explicitly injected synthetic handlers may grant mock deletion readiness.
    // The signed-session/Hono fixture must still require real reauthentication evidence.
    allowMockDeletion: sessionStorage.getItem(realAccountKey) !== "true",
  }),
  cases: {
    list: async () => {
      const state = read();
      if (!state.session.user) throw new Error("로그인이 필요해요.");
      return Object.values(state.cases);
    },
  },
  files: {
    list: async (id: string) => {
      const state = read();
      if (!state.session.user || !state.cases[id]) throw new Error("사건을 찾을 수 없어요.");
      return state.files[id] ?? [];
    },
  },
};
