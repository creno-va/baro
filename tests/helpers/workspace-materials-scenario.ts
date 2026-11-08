import type { Page } from "@playwright/test";
import type { WorkspaceMockState } from "../../src/client/api/mock/workspace";
import type { FileView, MessageView } from "../../src/client/api/types";
import type { V2ReworkReportState } from "../../src/contracts/v2";

export const materialsCaseId = "synthetic-case";
export const materialsCasePath = `/cases/${materialsCaseId}`;
export const materialsFixtureKey = "baro-api-mock-v1:files";

/** Test inputs for the existing shared mock adapter, never a second facade. */
export async function seedMaterialsScenario(
  page: Page,
  options: { messages?: number; files?: number; faults?: Record<string, string[]> } = {},
) {
  const createdAt = "2026-11-08T00:00:00.000Z";
  const files: FileView[] = Array.from({ length: options.files ?? 2 }, (_, index) => ({
    id: `synthetic-material-${index + 1}`,
    revision: 1,
    name:
      index === 0
        ? "반환 약속과 송금 날짜를 확인할 합성 자료.txt"
        : `긴파일명_${"합성자료".repeat(14)}_${index + 1}.txt`,
    mimeType: "text/plain",
    sizeBytes: 120,
    status: "ready",
    coverage: "합성 텍스트 1개 구간 · 외부 OCR·ASR 실행 없음",
    extractedText: `합성 자료 ${index + 1}. 300만원을 보냈고 반환 날짜는 확인이 필요합니다.`,
    createdAt,
  }));
  const messages: MessageView[] = Array.from({ length: options.messages ?? 0 }, (_, index) => ({
    id: `synthetic-message-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    status: "complete",
    text:
      index % 2 === 0
        ? `합성 질문 ${index + 1}: 날짜와 자료를 함께 확인하고 싶어요.`
        : `합성 응답 ${index + 1}. ${"확인된 자료와 미확인 진술을 구분하고 원본을 보관하세요. ".repeat(12)}`,
    createdAt: new Date(Date.parse(createdAt) + index * 1000).toISOString(),
  }));
  const state: WorkspaceMockState = {
    session: {
      user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      [materialsCaseId]: {
        id: materialsCaseId,
        title: "자료와 약속을 함께 확인하는 합성 사건",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: createdAt,
        summary: "합성 사건의 송금과 반환 약속을 자료로 확인합니다.",
        schemaVersion: "2",
        summaryDetails: {
          schemaVersion: "2",
          revision: 1,
          intakeRevision: 1,
          createdAt,
          overview: "합성 사건의 송금과 반환 약속을 자료로 확인합니다.",
          facts: [],
          parties: [],
          unknowns: ["반환 약속 날짜는 미확인입니다."],
          notices: ["실제 사건·공급자 실행이 없는 브라우저 회귀 입력입니다."],
        },
      },
    },
    caseOwners: { [materialsCaseId]: "synthetic-owner" },
    workspace: { [materialsCaseId]: { messages, actions: [], timeline: [] } },
    files: { [materialsCaseId]: files },
    faults: options.faults ?? {},
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ state }) => {
      if (localStorage.getItem("baro-api-mock-v1:session")) return;
      for (const [key, value] of Object.entries(state))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { state },
  );
}

/** Instrument the same authorized adapter to detect accidental reads/executions. */
export async function countMaterialsRequests(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const counts = { workspace: 0, files: 0, progress: 0, action: 0, send: 0 };
    const observed = window as unknown as { materialsRequestCounts: typeof counts };
    observed.materialsRequestCounts = counts;
    api.workspace = new Proxy(api.workspace, {
      get(target, property) {
        const action = Reflect.get(target, property);
        const key =
          property === "get"
            ? "workspace"
            : property === "getFiles"
              ? "files"
              : property === "sendMessage"
                ? "send"
                : null;
        if (!key) return action;
        return async (...args: unknown[]) => {
          counts[key]++;
          return action.apply(target, args);
        };
      },
    });
    api.rework = new Proxy(api.rework, {
      get(target, property) {
        const action = Reflect.get(target, property);
        const key =
          property === "getConversationProgress"
            ? "progress"
            : property === "executeAction"
              ? "action"
              : null;
        if (!key) return action;
        return async (...args: unknown[]) => {
          counts[key]++;
          return action.apply(target, args);
        };
      },
    });
  });
}

/** Override only a synthetic GET result; keep the adapter's owner checks intact. */
export async function setMaterialsReportRead(
  page: Page,
  status: V2ReworkReportState["status"] | "unavailable",
) {
  await page.evaluate(async (status) => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const fixturePath = "/tests/helpers/conversation-state.ts";
    const { limitedConversationState } = (await import(
      fixturePath
    )) as typeof import("./conversation-state");
    const schemaPath = "/src/contracts/v2/index.ts";
    const { v2ConversationStateSchema } = (await import(
      schemaPath
    )) as typeof import("../../src/contracts/v2");
    const scope = window as unknown as {
      originalMaterialsReworkClient?: typeof api.rework;
    };
    scope.originalMaterialsReworkClient ??= api.rework;
    const client = scope.originalMaterialsReworkClient;
    const read: typeof api.rework.getConversationProgress = async (...args) => {
      const authorized = await client.getConversationProgress(...args);
      if (status === "unavailable")
        throw Object.assign(new Error("합성 상태 조회 장애"), { code: "UNAVAILABLE" });
      const state = limitedConversationState("unconfirmed");
      state.workspaceRevision = authorized.state.workspaceRevision;
      state.caseContext = authorized.state.caseContext;
      state.summaryConfirmed = authorized.state.summaryConfirmed;
      state.report = {
        status,
        id: ["ready", "stale"].includes(status) ? "synthetic-saved-report" : null,
        revision: ["ready", "stale"].includes(status) ? 1 : null,
        basis: status === "ready" ? state.analysis.basis : null,
        currentJobId: status === "pending" ? "synthetic-pending-report" : null,
        failure: status === "failed" ? "INTERNAL_ERROR" : null,
      };
      return { ...authorized, state: v2ConversationStateSchema().parse(state) };
    };
    api.rework = new Proxy(client, {
      get: (target, property) =>
        property === "getConversationProgress" ? read : Reflect.get(target, property),
    });
  }, status);
}
