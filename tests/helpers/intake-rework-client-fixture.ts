// Isolated UI harness. Only the test Astro config aliases the product's facade.
// Shared clients/session fencing + synthetic HTTP adapters; no provider fallback is shipped.
import { createReworkClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import type { OperationRequest, OperationRequestOptions } from "../../packages/api-client/src/http";
import { browserSessionScope } from "../../src/client/api/context";
import { ApiError, responseError } from "../../src/client/api/core";
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
  v2CaseContextUpdateSchema,
  v2ReworkCreateCaseRequestSchema,
  v2ReworkVersionSchema,
  v2SummaryReconciliationSchema,
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
const request: OperationRequest = async <T>(
  _operation: string,
  input: unknown,
  options: OperationRequestOptions = {},
) => {
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
    if (!response.ok) throw await responseError(response);
    let value = v2SummaryReconciliationSchema.parse(await response.json());
    if (suffix === "confirm" && fault?.startsWith("confirm-continuation-")) {
      localStorage.removeItem("synthetic-reconciliation-fault");
      // Synthetic HTTP boundary conditions; real automatic preparation is
      // covered separately through the central signed Hono/runtime fixture.
      mockRuntime.update((store) => {
        const cases = store.cases;
        const id = decodeURIComponent(path.split("/")[4] ?? "");
        const item = cases[id];
        if (!item) throw new Error("Missing synthetic confirmed case");
        item.revision++;
        const records = store.summaryReconciliations as Record<string, typeof value>;
        const record = records[id];
        if (!record?.request || !record.proposal) throw new Error("Missing synthetic receipt");
        if (fault.endsWith("receipt")) record.confirmedWorkspaceRevision = item.revision;
        if (fault.endsWith("request")) {
          record.request.id = "different-confirmed-request";
          record.proposal.requestId = record.request.id;
        }
        if (fault.endsWith("body") && item.summaryDetails?.facts[0])
          item.summaryDetails.facts[0].text = "확정 변경안과 다른 합성 현재 사실입니다.";
        if (fault.endsWith("stale")) {
          record.status = "stale";
          record.confirmedWorkspaceRevision = null;
          record.confirmedSummaryRevision = null;
        }
        if (fault.endsWith("owner"))
          store.session.user = {
            id: "synthetic-other-owner",
            name: "다른 합성 계정",
            accountType: "customer",
          };
      });
    }
    // Actual runtime can expose a terminal job as failed while the immutable
    // private request remains pending/running. Reads must not retire that record.
    if (
      options.method === "GET" &&
      localStorage.getItem("synthetic-reconciliation-terminal-job") === "true" &&
      ["pending", "running"].includes(value.status)
    )
      value = {
        ...value,
        status: "failed",
        currentJobId: null,
        failure: "JOB_TIMEOUT",
      };
    if (fault === `${suffix}-peer-after` && ["request", "cancel"].includes(suffix)) {
      localStorage.removeItem("synthetic-reconciliation-fault");
      let saved = v2SummaryReconciliationSchema.parse(value);
      const base = path.replace(/\/(?:request|cancel)$/, "");
      const peer = async (action: string, body: unknown) => {
        const response = await reconcile(
          new Request(new URL(`${base}/${action}`, location.origin), {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify(body),
          }),
        );
        if (!response?.ok) throw new Error("Synthetic peer mutation failed");
        return v2SummaryReconciliationSchema.parse(await response.json());
      };
      if (suffix === "request")
        saved = await peer("cancel", {
          expectedRevision: saved.workspaceRevision,
          requestId: saved.request?.id,
        });
      await peer("request", {
        expectedRevision: saved.workspaceRevision,
        summaryRevision:
          saved.proposal?.baseSummaryRevision ?? saved.request?.input.summaryRevision,
        kind: "addition",
        explanation: "다른 탭에서 요청한 합성 보완 내용입니다.",
      });
    }
    if (fault === `${suffix}-lost-after`) {
      localStorage.removeItem("synthetic-reconciliation-fault");
      throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
    }
    if (fault === "confirm-ui-postflight" && suffix === "confirm")
      localStorage.setItem("synthetic-reconciliation-fault", "ui-session-once");
    return value as T;
  }
  const session = requireSession({ consent: options.method !== "GET" });
  const conversationMatch = /^\/api\/v2\/cases\/([^/]+)\/rework\/conversation$/.exec(path);
  if (conversationMatch) {
    const value = await original.rework.getConversation(
      decodeURIComponent(conversationMatch[1] ?? ""),
      {
        ...(options.expectedOwner ? { expectedOwner: options.expectedOwner } : {}),
      },
    );
    writeStore("syntheticInitialProofReads", readStore("syntheticInitialProofReads", 0) + 1);
    const fault = localStorage.getItem("synthetic-initial-proof-fault");
    return {
      ...value,
      ...(fault === "false" ? { summaryConfirmed: false } : {}),
      ...(fault === "revision" ? { workspaceRevision: value.workspaceRevision + 1 } : {}),
    } as T;
  }
  const contextMatch = /^\/api\/v2\/cases\/([^/]+)\/rework\/context$/.exec(path);
  if (contextMatch) {
    const id = decodeURIComponent(contextMatch[1] ?? "");
    const item = casesMockHandlers["cases.get"]({ id });
    const contexts = readStore<Record<string, V2CaseContext>>("reworkContexts", {});
    if (options.method === "PUT") {
      const update = v2CaseContextUpdateSchema.parse(input);
      if (update.expectedRevision !== item.revision)
        throw new ApiError("CONFLICT", "합성 context CAS 충돌");
      item.revision++;
      contexts[id] = {
        casePurpose: update.casePurpose,
        subjectContext: update.subjectContext,
        procedure: update.procedure,
      };
      const records = readStore<Record<string, typeof item>>("cases", {});
      records[id] = item;
      writeStore("cases", records);
      writeStore("reworkContexts", contexts);
      writeStore("syntheticStaleAnalysis", id);
    }
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
    ...(typeof sessionStorage === "undefined" ? {} : { keyStorage: sessionStorage }),
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
