import { z } from "zod";
import { maskReportText } from "../../../components/reports/download";
import { idempotencyKeySchema } from "../../../contracts";
import { EXPECTED_OWNER_HEADER } from "../../../contracts/session";
import {
  type V2CaseContext,
  type V2LegalAnalysisSnapshot,
  type V2ResolutionState,
  v2CaseContextUpdateSchema,
  v2ConversationActionRequestSchema,
  v2ConversationStateSchema,
  v2ResolutionDraftRequestSchema,
  v2ResolutionMutationSchema,
  v2ReworkCreateCaseRequestSchema,
  v2ReworkVersionSchema,
} from "../../../contracts/v2";
import {
  createResolutionService,
  ResolutionError,
} from "../../../server/modules/resolution/service";
import type { ResolutionSource } from "../../../server/modules/resolution/types";
import {
  ConversationAgentError,
  createConversationAgent,
} from "../../../server/modules/workspace/conversation-agent";
import type { CaseView } from "../types";
import { makeMockQuestions } from "./cases";
import { createReconciliationMock } from "./mock-reconciliation";
import { createReportsMockHandler, ReportMockError, type ReportMockState } from "./reports";
import {
  mockFailure,
  mockResponse,
  requireMockCase,
  WorkspaceMockError,
  type WorkspaceMockRuntime,
  type WorkspaceMockState,
} from "./workspace";

// Loaded only by PUBLIC_API_MODE=mock. Reuse the pure allowlist and resolution
// domain with local DI; no runtime/DB/provider capability enters this adapter.
type Receipt = { ownerId: string; caseId: string; fingerprint: string; value: unknown };
type MockState = WorkspaceMockState &
  ReportMockState & {
    reworkContexts?: Record<string, V2CaseContext>;
    reworkAnalyses?: Record<
      string,
      {
        snapshot: V2LegalAnalysisSnapshot;
        scope: { excludedFileIds: string[]; maskIdentifiers: boolean };
        sourceHash: string;
      }
    >;
    reworkResolutions?: Record<string, V2ResolutionState>;
    reworkReceipts?: Record<string, Receipt>;
    reworkReportBindings?: Record<string, string>;
  };
const version = v2ReworkVersionSchema.value;
const procedure = () => ({
  kind: "unconfirmed" as const,
  stage: "unconfirmed" as const,
  description: null,
});
function error(code: string, message: string): never {
  throw new WorkspaceMockError(code, message);
}
const hash = async (input: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export function createReworkMock(
  runtime: WorkspaceMockRuntime & { original?: (caseId: string, fileId: string) => Promise<Blob> },
) {
  const read = () => runtime.read() as MockState;
  const update = <T>(mutate: (state: MockState) => T) =>
    runtime.update((state) => mutate(state as MockState));
  const reconciliation = createReconciliationMock(runtime, {
    invalidate(state, id) {
      const s = state as MockState;
      if (s.reports[id]) s.reports[id].stale = true;
    },
  });
  const reports = createReportsMockHandler({
    read,
    update: (fn) => update(fn),
    original: runtime.original ?? (async () => error("NOT_FOUND", "원본을 찾을 수 없어요.")),
  });
  function owned(state: MockState, id: string, write = false, expected?: string | null) {
    const item = requireMockCase(state, id, false),
      owner = state.session.user;
    if (
      !owner ||
      !["customer", "lawyer"].includes(owner.accountType) ||
      state.caseOwners?.[id] !== owner.id
    )
      error("NOT_FOUND", "사건을 찾을 수 없어요.");
    if (expected !== undefined && expected !== null && decodeURIComponent(expected) !== owner.id)
      error("UNAUTHENTICATED", "이용 계정이 바뀌었어요.");
    if (write && state.session.needsConsent)
      error("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
    if (write && item.stage === "archived") error("CONFLICT", "보관한 사건을 먼저 확인해 주세요.");
    return item;
  }
  const context = (state: MockState, id: string): V2CaseContext =>
    state.reworkContexts?.[id] ?? {
      casePurpose: "unconfirmed",
      subjectContext: state.cases[id]?.subjectContext ?? "individual",
      procedure: procedure(),
    };
  const scope = (state: MockState, id: string) => ({
    excludedFileIds: [...(state.reports[id]?.excludedFileIds ?? [])].sort(),
    maskIdentifiers: state.reports[id]?.maskIdentifiers ?? false,
  });
  const sourceHash = (state: MockState, id: string) =>
    hash({
      case: state.cases[id],
      context: context(state, id),
      files: state.files[id] ?? [],
      reviews: Object.fromEntries(
        (state.files[id] ?? []).map((file) => [file.id, state.fileReviews?.[file.id] ?? null]),
      ),
      scope: scope(state, id),
    });
  async function stateFor(id: string) {
    const state = read(),
      item = owned(state, id),
      ctx = context(state, id),
      stored = state.reworkAnalyses?.[id];
    const current = stored && stored.sourceHash === (await sourceHash(state, id));
    owned(read(), id, false, state.session.user?.id);
    const snapshot = stored?.snapshot ?? null;
    const analysis = stored
      ? {
          status: current ? snapshot?.status : "stale",
          basis: snapshot?.basis,
          currentJobId: null,
          failure: null,
          missingItems: current
            ? snapshot?.limitations
            : ["사건이나 자료가 바뀌었어요. 최신 내용을 다시 확인해 주세요."],
        }
      : { status: "not_started", basis: null, currentJobId: null, failure: null, missingItems: [] };
    const report = state.reports[id],
      ready =
        report &&
        !report.stale &&
        !state.reworkEditedReports?.[report.id] &&
        current &&
        state.reworkReportBindings?.[report.id] === snapshot?.id;
    return v2ConversationStateSchema().parse({
      contractVersion: version,
      workspaceRevision: item.revision,
      caseContext: ctx,
      summaryConfirmed: item.stage === "active",
      pendingEvidenceIds: (state.files[id] ?? [])
        .filter(
          (f) =>
            !["ready", "failed"].includes(f.status) &&
            !scope(state, id).excludedFileIds.includes(f.id),
        )
        .map((f) => f.id),
      analysis,
      snapshot,
      report: {
        status: report ? (ready ? "ready" : "stale") : "not_started",
        id: report?.id ?? null,
        revision: report?.revision ?? null,
        basis: ready ? snapshot?.basis : null,
        currentJobId: null,
        failure: null,
      },
      intents: [],
    });
  }
  async function peek(id: string) {
    const state = read();
    owned(state, id);
    const report = state.reports[id];
    if (!report) return null;
    const conversation = await stateFor(id),
      snapshot = conversation.snapshot,
      current =
        snapshot !== null &&
        ["ready", "partial", "empty", "unavailable"].includes(conversation.analysis.status) &&
        state.reworkReportBindings?.[report.id] === snapshot.id,
      userEdited =
        !!state.reworkEditedReports?.[report.id] || !state.reworkReportBindings?.[report.id];
    return {
      ...report,
      stale: report.stale || !current,
      analysisReview: {
        analysisId: current ? snapshot.id : null,
        status: current && !userEdited ? snapshot.status : "review_required",
        userEdited,
        checkedAt: current ? snapshot.checkedAt : null,
      },
    };
  }
  async function prepareReport(ownerId: string, id: string) {
    const state = read();
    owned(state, id, true, ownerId);
    const prior = state.reports[id],
      oldScope = scope(state, id);
    await reports(`/api/v2/cases/${encodeURIComponent(id)}/reports`, {
      method: "POST",
      body: {
        expectedRevision: prior?.revision ?? null,
        excludedFileIds: oldScope.excludedFileIds,
      },
    });
    if (oldScope.maskIdentifiers) {
      const made = read().reports[id];
      if (!made) error("NOT_FOUND", "리포트를 찾을 수 없어요.");
      await reports(`/api/v2/cases/${encodeURIComponent(id)}/reports`, {
        method: "PATCH",
        body: {
          expectedRevision: made.revision,
          content: maskReportText(made.content),
          excludedFileIds: oldScope.excludedFileIds,
          maskIdentifiers: true,
        },
      });
    }
    update((s) => {
      owned(s, id, true, ownerId);
      const report = s.reports[id],
        analysis = s.reworkAnalyses?.[id];
      if (report && analysis) {
        s.reworkReportBindings ??= {};
        s.reworkReportBindings[report.id] = analysis.snapshot.id;
        delete s.reworkEditedReports?.[report.id];
      }
    });
    return { operationId: null, workspaceRevision: owned(read(), id).revision };
  }
  async function analyze(ownerId: string, id: string, continueWithReport: boolean) {
    const state = read(),
      item = owned(state, id, true, ownerId),
      ctx = context(state, id);
    if (ctx.casePurpose === "unconfirmed")
      error("REVIEW_REQUIRED", "사건의 진행 목적을 먼저 확인해 주세요.");
    const source = await sourceHash(state, id),
      now = new Date().toISOString();
    const snapshot: V2LegalAnalysisSnapshot = {
      contractVersion: version,
      id: crypto.randomUUID(),
      basis: {
        researchRevision: item.revision,
        summaryRevision: item.summaryDetails?.revision ?? 1,
        evidenceHash: source,
        casePurpose: ctx.casePurpose,
      },
      context: ctx,
      basedOnFactIds: [],
      includedEvidence: [],
      asOfDate: new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10),
      checkedAt: now,
      status: "unavailable",
      citations: [],
      retrievalHash: await hash([]),
      availability: [{ kind: "statute", status: "unavailable", reason: "configuration_missing" }],
      issues: [],
      precedents: [],
      perspective: {
        casePurpose: ctx.casePurpose,
        weaknesses: [],
        claimGaps: [],
        responsePoints: [],
        additionalMaterials: [],
      },
      evidenceRequirements: [],
      sourceClaims: [],
      limitations: [
        "합성 예시 모드에서는 실제 법령·판례 조회와 모델 분석을 실행하지 않았어요. 공식 근거를 확인한 결과로 사용할 수 없어요.",
      ],
    };
    update((s) => {
      const latest = owned(s, id, true, ownerId);
      if (latest.revision !== item.revision) error("CONFLICT", "사건이 변경됐어요.");
      s.reworkAnalyses ??= {};
      s.reworkAnalyses[id] = { snapshot, scope: scope(s, id), sourceHash: source };
    });
    if (continueWithReport) await prepareReport(ownerId, id);
    return {
      operationId: `synthetic-${crypto.randomUUID()}`,
      workspaceRevision: owned(read(), id).revision,
    };
  }
  async function resolutionSource(ownerId: string, id: string): Promise<ResolutionSource> {
    const state = read(),
      item = owned(state, id, false, ownerId),
      conversation = await stateFor(id),
      report = state.reports[id],
      snapshot = conversation.snapshot;
    const basis =
      conversation.report.status === "ready" && snapshot && report
        ? {
            ...snapshot.basis,
            workspaceRevision: item.revision,
            analysisId: snapshot.id,
            reportId: report.id,
            reportRevision: report.revision,
            procedure: context(state, id).procedure,
          }
        : null;
    const selected = (state.files[id] ?? []).filter(
      (f) => f.status === "ready" && !report?.excludedFileIds.includes(f.id),
    );
    return {
      basis,
      context: context(state, id),
      report: report
        ? {
            id: report.id,
            revision: report.revision,
            stale: conversation.report.status !== "ready",
            selectedFileIds: selected.map((f) => f.id),
            maskIdentifiers: report.maskIdentifiers,
          }
        : null,
      stored: state.reworkResolutions?.[id] ?? null,
      facts:
        item.summaryDetails?.facts
          .filter((f) => ["user_statement", "user_material"].includes(f.attribution))
          .map((f) => ({
            id: f.id,
            text: f.text,
            confirmed: true,
            fileIds: f.references.flatMap((r) => (r.kind === "user_material" ? [r.fileId] : [])),
          })) ?? [],
      files: selected.map((f) => ({
        id: f.id,
        revision: f.revision ?? 1,
        contentHash: "0".repeat(64),
        name: f.name,
        text: "합성 예시의 업로드 자료입니다. 원문과 처리 범위는 자료 검토에서 확인해 주세요.",
      })),
      analysis: snapshot,
      citations: [],
      sourceClaims: [],
      procedureChecks: [],
      documentSupport: [],
      maskingTokens: item.summaryDetails?.parties.map((p) => p.label) ?? [],
    };
  }
  const resolution = createResolutionService({
    load: resolutionSource,
    authorize: async (owner, id, basis, mode) => {
      try {
        owned(read(), id, mode === "write", owner);
        return (
          !basis ||
          JSON.stringify((await resolutionSource(owner, id)).basis) === JSON.stringify(basis)
        );
      } catch {
        return false;
      }
    },
    saveCAS: async (owner, id, input) =>
      update((s) => {
        owned(s, id, true, owner);
        const before = s.reworkResolutions?.[id];
        if ((before?.revision ?? 1) !== input.expectedRevision) return false;
        s.reworkResolutions ??= {};
        s.reworkResolutions[id] = input.state;
        return true;
      }),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    guideHosts: [],
  });
  const inflight = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  async function once<T>(
    ownerId: string,
    id: string,
    key: string,
    body: unknown,
    work: () => Promise<T>,
  ) {
    owned(read(), id, true, ownerId);
    const identity = `${ownerId}/${id}/${key}`,
      fingerprint = JSON.stringify(body),
      prior = read().reworkReceipts?.[identity];
    if (prior) {
      if (prior.fingerprint !== fingerprint) error("CONFLICT", "같은 요청 키의 내용이 달라요.");
      return structuredClone(prior.value) as T;
    }
    const running = inflight.get(identity);
    if (running) {
      if (running.fingerprint !== fingerprint) error("CONFLICT", "같은 요청 키의 내용이 달라요.");
      return running.promise as Promise<T>;
    }
    const promise = (async () => {
      const value = await work();
      return update((s) => {
        owned(s, id, true, ownerId);
        s.reworkReceipts ??= {};
        s.reworkReceipts[identity] = {
          ownerId,
          caseId: id,
          fingerprint,
          value: structuredClone(value),
        };
        return value;
      });
    })();
    inflight.set(identity, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      inflight.delete(identity);
    }
  }
  const agent = createConversationAgent({
    authorize: async (owner, id) => {
      try {
        owned(read(), id, true, owner);
        return true;
      } catch {
        return false;
      }
    },
    load: async (owner, id) => {
      const s = read(),
        item = owned(s, id, false, owner);
      return {
        state: await stateFor(id),
        canMutate: !s.session.needsConsent,
        archived: item.stage === "archived",
        workspaceJobId: null,
      };
    },
    once: (input, work) =>
      once(input.ownerId, input.caseId, input.request.requestId, input.request, work),
    analyze: (input, options) => analyze(input.ownerId, input.caseId, options.continueWithReport),
    prepareReport: (input) => prepareReport(input.ownerId, input.caseId),
    selectResolution: async (input) => {
      const state = await resolution.get(input.ownerId, input.caseId),
        report = read().reports[input.caseId];
      if (!report) error("REVIEW_REQUIRED", "리포트를 먼저 준비해 주세요.");
      await resolution.update(input.ownerId, input.caseId, {
        action: "select",
        choice: input.request.choice,
        expectedRevision: state.revision,
        reportId: report.id,
        reportRevision: report.revision,
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
      });
      return { operationId: null, workspaceRevision: owned(read(), input.caseId).revision };
    },
  });
  return async (request: Request): Promise<Response | null> => {
    const parsed = new URL(request.url),
      match =
        /^\/api\/v2\/cases\/([^/]+)\/rework\/(context|conversation|actions|report|resolution(?:\/draft)?)$/.exec(
          parsed.pathname,
        );
    if (parsed.pathname !== "/api/v2/cases/rework" && !match) return reconciliation(request);
    try {
      if (parsed.search) error("VALIDATION_ERROR", "요청 조건을 확인해 주세요.");
      const expected = request.headers.get(EXPECTED_OWNER_HEADER),
        mutation = request.method !== "GET",
        key = mutation ? idempotencyKeySchema.parse(request.headers.get("idempotency-key")) : "";
      if (!match) {
        if (request.method !== "POST") return mockResponse({}, 405);
        const body = v2ReworkCreateCaseRequestSchema.parse(await request.json()),
          state = read(),
          user = state.session.user;
        if (!user || state.deletedAccountIds?.includes(user.id))
          error("UNAUTHENTICATED", "로그인이 필요해요.");
        if (state.session.needsConsent) error("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
        if (expected && decodeURIComponent(expected) !== user.id)
          error("UNAUTHENTICATED", "이용 계정이 바뀌었어요.");
        const { turnstileToken: _token, ...business } = body,
          fingerprint = JSON.stringify(business),
          receiptKey = `${user.id}/create/${key}`,
          previous = state.reworkReceipts?.[receiptKey];
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            error("CONFLICT", "같은 요청 키의 내용이 달라요.");
          owned(state, previous.caseId, true, user.id);
          return mockResponse(previous.value, 201);
        }
        const made = update((s) => {
          if (s.session.user?.id !== user.id || s.session.needsConsent)
            error("UNAUTHENTICATED", "이용 상태가 바뀌었어요.");
          if (Object.keys(s.cases).filter((id) => s.caseOwners?.[id] === user.id).length >= 3)
            error("QUOTA_EXCEEDED", "예시에서는 사건을 세 개까지 만들 수 있어요.");
          const id = crypto.randomUUID(),
            now = new Date().toISOString(),
            item: CaseView = {
              id,
              title: "새 사건 정리",
              subjectContext: body.subjectContext,
              stage: "intake",
              revision: 1,
              updatedAt: now,
              summary: "",
              schemaVersion: "2",
            };
          s.cases[id] = item;
          s.caseOwners ??= {};
          s.caseOwners[id] = user.id;
          s.reworkContexts ??= {};
          s.reworkContexts[id] = {
            casePurpose: body.casePurpose,
            subjectContext: body.subjectContext,
            procedure: procedure(),
          };
          const questions = makeMockQuestions(body.narrative, body.subjectContext);
          if (body.casePurpose === "respond_to_claim" && questions[1])
            questions[1].text = "상대방은 어떤 내용을 주장하나요?";
          s.intake ??= {};
          s.intake[id] = {
            narrative: body.narrative,
            questions,
            rounds: [{ ordinal: 1, questionIds: questions.map((q) => q.id) }],
          };
          const result = {
            contractVersion: version,
            context: s.reworkContexts[id],
            workspace: {
              schemaVersion: "2",
              id,
              title: "사건 작업 공간",
              subjectContext: item.subjectContext,
              jurisdiction: "KR",
              status: "intake",
              archivedFrom: null,
              workspaceRevision: 1,
              intakeRevision: 1,
              confirmedSummaryRevision: null,
              currentJobId: null,
              legacySnapshotId: null,
              createdAt: now,
              updatedAt: now,
            },
          };
          s.reworkReceipts ??= {};
          s.reworkReceipts[receiptKey] = {
            ownerId: user.id,
            caseId: id,
            fingerprint,
            value: result,
          };
          return result;
        });
        return mockResponse(made, 201);
      }
      const id = decodeURIComponent(match[1] ?? ""),
        route = match[2],
        item = owned(read(), id, mutation, expected),
        owner = read().session.user?.id ?? "";
      if (route === "context" && request.method === "GET")
        return mockResponse({
          contractVersion: version,
          workspaceRevision: item.revision,
          context: context(read(), id),
        });
      if (route === "context" && request.method === "PUT") {
        const body = v2CaseContextUpdateSchema.parse(await request.json());
        return mockResponse(
          await once(owner, id, key, body, async () =>
            update((s) => {
              const current = owned(s, id, true, owner);
              if (current.revision !== body.expectedRevision)
                error("CONFLICT", "사건이 변경됐어요.");
              const { expectedRevision: _revision, ...ctx } = body;
              s.reworkContexts ??= {};
              s.reworkContexts[id] = ctx;
              current.subjectContext = ctx.subjectContext;
              current.revision++;
              current.updatedAt = new Date().toISOString();
              return {
                contractVersion: version,
                workspaceRevision: current.revision,
                context: ctx,
              };
            }),
          ),
        );
      }
      if (route === "conversation" && request.method === "GET")
        return mockResponse(await stateFor(id));
      if (route === "report" && request.method === "GET") return mockResponse(await peek(id));
      if (route === "actions" && request.method === "POST")
        return mockResponse(
          await agent.execute(
            owner,
            id,
            v2ConversationActionRequestSchema.parse(await request.json()),
          ),
        );
      if (route === "resolution" && request.method === "GET")
        return mockResponse(await resolution.get(owner, id));
      if (route === "resolution" && request.method === "PATCH") {
        const body = v2ResolutionMutationSchema.parse(await request.json());
        return mockResponse(
          await once(owner, id, key, body, () => resolution.update(owner, id, body)),
        );
      }
      if (route === "resolution/draft" && request.method === "POST") {
        const body = v2ResolutionDraftRequestSchema.parse(await request.json());
        return mockResponse(
          await once(owner, id, key, body, () => resolution.prepareDraft(owner, id, body)),
        );
      }
      return mockResponse({}, 405);
    } catch (cause) {
      if (
        cause instanceof ReportMockError &&
        ["EXPORT_LIMIT_EXCEEDED", "EXPORT_RETRY_EXHAUSTED"].includes(cause.code)
      )
        return mockResponse(
          {
            error: {
              code: cause.code,
              message: "리포트의 처리 한도와 다운로드 재시도 조건을 확인해 주세요.",
              retryable: false,
            },
          },
          cause.code === "EXPORT_LIMIT_EXCEEDED" ? 413 : 409,
        );
      if (cause instanceof ConversationAgentError || cause instanceof ResolutionError)
        return mockFailure(
          new WorkspaceMockError(
            cause.code === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT",
            "현재 사건과 리포트의 상태를 다시 확인해 주세요.",
          ),
        );
      if (cause instanceof z.ZodError)
        return mockFailure(
          new WorkspaceMockError("VALIDATION_ERROR", "요청 조건을 확인해 주세요."),
        );
      return mockFailure(cause);
    }
  };
}
