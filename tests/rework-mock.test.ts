import { expect, test } from "bun:test";
import { createJsonRequester, createReworkClient } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { createAccountMockHandler } from "../src/client/api/mock/account";
import type { ReportMockState } from "../src/client/api/mock/reports";
import { createReworkMock } from "../src/client/api/mock/rework";
import type { WorkspaceMockState } from "../src/client/api/mock/workspace";
import { reconfirmationCase } from "./helpers/intake-reconfirmation";

function fixture() {
  const item = { ...reconfirmationCase(), stage: "active" as const };
  let state: WorkspaceMockState & ReportMockState = {
    session: {
      user: { id: "mock-owner", name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    },
    cases: { [item.id]: item },
    caseOwners: { [item.id]: "mock-owner" },
    files: {},
    workspace: {},
    reports: {},
  };
  const runtime = {
    read: () => structuredClone(state),
    update: <T>(work: (s: WorkspaceMockState) => T): T => {
      const next = structuredClone(state),
        value = work(next);
      state = next;
      return value;
    },
  };
  let handler = createReworkMock(runtime);
  const request = createJsonRequester({
    transport: async (path, init) =>
      (await handler(new Request(new URL(path, "http://localhost"), init))) ??
      new Response("", { status: 404 }),
    newKey: () => crypto.randomUUID(),
  });
  const scope = createSessionScope();
  const client = createReworkClient({
    request: (_op, _input, options = {}) =>
      request({ ...options, path: options.path ?? "/invalid" }),
    scope,
    session: async () => state.session,
    newKey: () => crypto.randomUUID(),
    challenge: async () => "synthetic",
    fingerprint: async (value) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
  });
  return {
    item,
    client,
    runtime,
    read: () => state,
    change: (fn: (s: typeof state) => void) => fn(state),
    reload: () => {
      handler = createReworkMock(runtime);
    },
  };
}
test("an actual explicit-mock report size failure survives the rework boundary without an empty report", async () => {
  const f = fixture();
  f.change((state) => {
    state.files[f.item.id] = [
      {
        id: "oversized-synthetic-material",
        name: "합성 자료.txt",
        mimeType: "text/plain",
        sizeBytes: 120000,
        status: "ready",
        coverage: "전체",
        extractedText: "합성".repeat(20000),
      },
    ];
  });
  const context = await f.client.getContext(f.item.id);
  const next = await f.client.updateContext(f.item.id, {
    expectedRevision: context.workspaceRevision,
    casePurpose: "prepare_claim",
    subjectContext: "individual",
    procedure: context.context.procedure,
  });
  await expect(
    f.client.executeAction(f.item.id, {
      action: "prepare_report",
      requestId: crypto.randomUUID(),
      expectedRevision: next.workspaceRevision,
    }),
  ).rejects.toMatchObject({
    code: "EXPORT_LIMIT_EXCEEDED",
    httpStatus: 413,
    retryable: false,
  });
  expect(Object.keys(f.read().reports)).toHaveLength(0);
  expect(f.read().files[f.item.id]?.[0]?.extractedText).toBe("합성".repeat(20000));
});
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  for (const choice of ["self", "lawyer", "save_report"] as const)
    test(`explicit mock ${purpose} → unavailable legal analysis → report → ${choice} reuses domain services`, async () => {
      const f = fixture();
      expect(await f.client.peekReport(f.item.id)).toBeNull();
      expect(Object.keys(f.read().reports)).toHaveLength(0);
      const context = await f.client.getContext(f.item.id);
      expect(context.context.casePurpose).toBe("unconfirmed");
      const next = await f.client.updateContext(f.item.id, {
        expectedRevision: context.workspaceRevision,
        casePurpose: purpose,
        subjectContext: "company",
        procedure: { kind: "civil", stage: "first_instance", description: null },
      });
      const action = {
        requestId: crypto.randomUUID(),
        expectedRevision: next.workspaceRevision,
        action: "prepare_report" as const,
      };
      const first = await f.client.executeAction(f.item.id, action);
      f.reload();
      expect(await f.client.executeAction(f.item.id, action)).toEqual(first);
      const conversation = await f.client.getConversation(f.item.id);
      expect(conversation.analysis.status).toBe("unavailable");
      expect(conversation.snapshot?.citations).toEqual([]);
      expect(conversation.report.status).toBe("ready");
      expect(conversation.analysis.missingItems.join(" ")).toContain(
        "실제 법령·판례 조회와 모델 분석을 실행하지 않았어요",
      );
      const report = await f.client.peekReport(f.item.id);
      expect(report?.analysisReview?.status).toBe("unavailable");
      if (!report) throw new Error("missing report");
      await f.client.executeAction(f.item.id, {
        requestId: crypto.randomUUID(),
        expectedRevision: conversation.workspaceRevision,
        action: "resolve_followup",
        choice,
      });
      let resolution = await f.client.getResolution(f.item.id);
      expect(resolution.selection).toBe(choice);
      expect(resolution.allowedDocumentKinds).toEqual(["fact_statement"]);
      if (choice === "self") {
        resolution = await f.client.prepareDraft(f.item.id, {
          expectedRevision: resolution.revision,
          reportId: report.id,
          reportRevision: report.revision,
          documentKind: "fact_statement",
          selectedFileIds: resolution.selectedFileIds,
          maskIdentifiers: true,
          factsConfirmed: true,
        });
        expect(resolution.draft?.reviewed).toBe(false);
        if (!resolution.draft) throw new Error("missing draft");
        const saved = await f.client.updateResolution(f.item.id, {
          action: "save_draft",
          expectedRevision: resolution.revision,
          reportId: report.id,
          reportRevision: report.revision,
          draftId: resolution.draft.id,
          draftRevision: resolution.draft.revision,
          content: resolution.draft.content,
          reviewed: true,
        });
        expect(saved.draft?.status).toBe("saved");
      }
    });
test("mock creation stores purpose atomically and retains old intake state", async () => {
  const f = fixture();
  const made = await f.client.createCase({
    narrative: "상대방 청구에 대응할 계약서와 대화 내역을 정리합니다.",
    subjectContext: "individual",
    casePurpose: "respond_to_claim",
  });
  expect((await f.client.getContext(made.id)).context).toMatchObject({
    casePurpose: "respond_to_claim",
    subjectContext: "individual",
    procedure: { kind: "unconfirmed", stage: "unconfirmed" },
  });
  expect(f.read().intake?.[made.id]).toMatchObject({
    narrative: "상대방 청구에 대응할 계약서와 대화 내역을 정리합니다.",
  });
  expect((await f.client.getConversation(made.id)).summaryConfirmed).toBe(false);
});
test("mock account switch, consent withdrawal and deletion cannot reuse private receipts or leave rework records", async () => {
  const f = fixture();
  const c = await f.client.getContext(f.item.id);
  await f.client.updateContext(f.item.id, {
    expectedRevision: c.workspaceRevision,
    casePurpose: "prepare_claim",
    subjectContext: "individual",
    procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
  });
  const action = {
    requestId: crypto.randomUUID(),
    expectedRevision: f.read().cases[f.item.id]?.revision ?? 0,
    action: "prepare_report" as const,
  };
  await f.client.executeAction(f.item.id, action);
  f.change((s) => {
    s.session.needsConsent = true;
  });
  await expect(f.client.executeAction(f.item.id, action)).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
  f.change((s) => {
    s.session.needsConsent = false;
    s.session.user = { id: "peer", name: "다른 합성 계정", accountType: "customer" };
  });
  await expect(f.client.getContext(f.item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  f.change((s) => {
    s.session.user = { id: "mock-owner", name: "합성 사용자", accountType: "customer" };
  });
  const account = createAccountMockHandler({
    read: f.runtime.read,
    update: (fn) => f.runtime.update((s) => fn(s as WorkspaceMockState & ReportMockState)),
    removeOriginals: async () => {},
  });
  await account(`/api/v2/cases/${f.item.id}`, { method: "DELETE" });
  for (const name of [
    "reworkContexts",
    "reworkAnalyses",
    "reworkResolutions",
    "summaryReconciliations",
  ]) {
    const values = f.read()[name] as Record<string, unknown> | undefined;
    expect(values?.[f.item.id]).toBeUndefined();
  }
  expect(
    Object.values(f.read().reworkReceipts as Record<string, { caseId: string }>).some(
      (r) => r.caseId === f.item.id,
    ),
  ).toBe(false);
  await expect(f.client.getContext(f.item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
