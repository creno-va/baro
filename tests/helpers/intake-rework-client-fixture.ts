// Isolated UI harness. Only the test Astro config aliases the product's facade.
// Shared clients/session fencing + synthetic HTTP adapters; no provider fallback is shipped.
import { createReworkClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import type { OperationRequest } from "../../packages/api-client/src/http";
import { browserSessionScope } from "../../src/client/api/context";
import { ApiError } from "../../src/client/api/core";
import { api as original } from "../../src/client/api/index";
import { casesMockHandlers } from "../../src/client/api/mock/cases";
import { createReconciliationMock } from "../../src/client/api/mock/mock-reconciliation";
import {
  mockRuntime,
  readStore,
  requireSession,
  writeStore,
} from "../../src/client/api/mock/runtime";
import type { WorkspaceMockRuntime, WorkspaceMockState } from "../../src/client/api/mock/workspace";
import {
  type V2CaseContext,
  v2ReworkCreateCaseRequestSchema,
  v2ReworkVersionSchema,
} from "../../src/contracts/v2";

const runtime: WorkspaceMockRuntime = {
  read: () => mockRuntime.read() as WorkspaceMockState,
  update: (mutate) => mockRuntime.update((value) => mutate(value as WorkspaceMockState)),
};
const reconcile = createReconciliationMock(runtime, {
  invalidate: (state, id) => {
    state.syntheticStaleAnalysis = id;
  },
});
const neutralProcedure = { kind: "unconfirmed", stage: "unconfirmed", description: null } as const;
const request: OperationRequest = async <T>(_operation: string, input: unknown, options = {}) => {
  if (!options.path) throw new Error("Missing synthetic path");
  const path = options.path;
  const suffix = path.split("/").at(-1) ?? "read";
  const fault = localStorage.getItem("synthetic-reconciliation-fault");
  const counts = readStore<Record<string, number>>("syntheticReconciliationCounts", {});
  if (options.method && options.method !== "GET") {
    counts[suffix] = (counts[suffix] ?? 0) + 1;
    writeStore("syntheticReconciliationCounts", counts);
  }
  if (fault === `${suffix}-fail-before`) {
    localStorage.removeItem("synthetic-reconciliation-fault");
    throw new ApiError("UNAVAILABLE", "합성 저장 실패", true);
  }
  const response = await reconcile(
    new Request(new URL(path, location.origin), {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "idempotency-key": options.key ?? crypto.randomUUID(),
        ...(options.expectedOwner
          ? { "x-baro-expected-owner": encodeURIComponent(options.expectedOwner) }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  if (response) {
    if (!response.ok) {
      const body = (await response.json()) as {
        error: { code: string; message: string; retryable: boolean };
      };
      throw new ApiError(body.error.code, body.error.message, body.error.retryable);
    }
    const value = await response.json();
    if (fault === `${suffix}-lost-after`) {
      localStorage.removeItem("synthetic-reconciliation-fault");
      throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
    }
    if (fault === "confirm-ui-postflight" && suffix === "confirm")
      localStorage.setItem("synthetic-reconciliation-fault", "ui-session-once");
    return value as T;
  }
  const session = requireSession({ consent: options.method !== "GET" });
  const contextMatch = /^\/api\/v2\/cases\/([^/]+)\/rework\/context$/.exec(path);
  if (contextMatch) {
    const id = decodeURIComponent(contextMatch[1] ?? "");
    const item = casesMockHandlers["cases.get"]({ id });
    const contexts = readStore<Record<string, V2CaseContext>>("reworkContexts", {});
    return {
      contractVersion: v2ReworkVersionSchema.value,
      workspaceRevision: item.revision,
      context: contexts[id] ?? {
        casePurpose: "unconfirmed",
        subjectContext: item.subjectContext,
        procedure: neutralProcedure,
      },
    } as T;
  }
  if (path === "/api/v2/cases/rework" && options.method === "POST") {
    const body = v2ReworkCreateCaseRequestSchema.parse(input);
    if (!session.user) throw new Error("Missing synthetic owner");
    const item = casesMockHandlers["cases.create"](
      { narrative: body.narrative, subjectContext: body.subjectContext },
      { key: options.key ?? crypto.randomUUID() },
    );
    const contexts = readStore<Record<string, V2CaseContext>>("reworkContexts", {});
    contexts[item.id] = {
      casePurpose: body.casePurpose,
      subjectContext: body.subjectContext,
      procedure: neutralProcedure,
    };
    writeStore("reworkContexts", contexts);
    return {
      contractVersion: v2ReworkVersionSchema.value,
      context: contexts[item.id],
      workspace: {
        schemaVersion: "2",
        id: item.id,
        title: "사건 작업 공간",
        subjectContext: item.subjectContext,
        jurisdiction: "KR",
        status: "intake",
        archivedFrom: null,
        workspaceRevision: item.revision,
        intakeRevision: 1,
        confirmedSummaryRevision: null,
        currentJobId: null,
        legacySnapshotId: null,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
      },
    } as T;
  }
  throw new ApiError("UNAVAILABLE", "이 합성 하네스에서는 지원하지 않는 경로예요.", true);
};
const rework = createSessionBoundClient(browserSessionScope, () =>
  createReworkClient({
    request,
    session: () => original.session.get(),
    scope: browserSessionScope,
    challenge: async () => "synthetic",
    fingerprint: async (input) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
    newKey: () => crypto.randomUUID(),
    keyStorage: sessionStorage,
  }),
);
export const api = {
  ...original,
  rework,
  session: {
    ...original.session,
    get: async () => {
      if (localStorage.getItem("synthetic-reconciliation-fault") === "ui-session-once") {
        localStorage.removeItem("synthetic-reconciliation-fault");
        throw new ApiError("UNAVAILABLE", "합성 저장 후 세션 조회 실패", true);
      }
      return original.session.get();
    },
  },
};
