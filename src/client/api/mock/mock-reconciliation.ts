import { EXPECTED_OWNER_HEADER } from "../../../contracts/session";
import {
  type V2Summary,
  type V2SummaryReconciliation,
  type V2SummaryReconciliationProposal,
  v2ReworkVersionSchema,
  v2SummaryReconciliationCancelSchema,
  v2SummaryReconciliationConfirmSchema,
  v2SummaryReconciliationRequestSchema,
  v2SummaryReconciliationSchema,
  v2SummarySchema,
} from "../../../contracts/v2";
import type { CaseView } from "../types";
import {
  mockFailure,
  mockResponse,
  WorkspaceMockError,
  type WorkspaceMockRuntime,
  type WorkspaceMockState,
} from "./workspace";

type Records = Record<string, V2SummaryReconciliation>;
type Receipt = { fingerprint: string; value: V2SummaryReconciliation };
function fail(code: string, message: string): never {
  throw new WorkspaceMockError(code, message);
}
function owned(
  state: WorkspaceMockState,
  id: string,
  mutation: boolean,
  expectedOwner: string | null,
) {
  const user = state.session?.user;
  if (!user || state.deletedAccountIds?.includes(user.id))
    fail("UNAUTHENTICATED", "로그인이 필요해요.");
  if (expectedOwner !== null && decodeURIComponent(expectedOwner) !== user.id)
    fail("UNAUTHENTICATED", "이용 계정이 바뀌었어요.");
  if (!state.cases[id] || state.caseOwners?.[id] !== user.id || state.deletedCaseIds?.includes(id))
    fail("NOT_FOUND", "사건을 찾을 수 없어요.");
  if (mutation && state.session.needsConsent)
    fail("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
  return { item: state.cases[id] as CaseView, ownerId: user.id };
}
export function emptyReconciliation(workspaceRevision: number): V2SummaryReconciliation {
  return {
    contractVersion: v2ReworkVersionSchema.value,
    workspaceRevision,
    status: "idle",
    request: null,
    proposal: null,
    currentJobId: null,
    failure: null,
    confirmedSummaryRevision: null,
    confirmedWorkspaceRevision: null,
  };
}
function summary(item: CaseView): V2Summary {
  return (
    item.summaryDetails ??
    v2SummarySchema.parse({
      schemaVersion: "2",
      revision: 1,
      intakeRevision: 1,
      createdAt: item.updatedAt,
      overview: item.summary,
      facts: [],
      parties: [],
      unknowns: [],
      notices: ["합성 adapter의 예시 정리입니다."],
    })
  );
}
/** Explicitly synthetic: explanation is an additional statement, never an actual AI correction. */
function syntheticProposal(
  before: V2Summary,
  request: NonNullable<V2SummaryReconciliation["request"]>,
): V2Summary {
  const overview = `${before.overview}\n\n추가로 알려준 내용: ${request.input.explanation}`;
  return v2SummarySchema.parse({
    ...before,
    revision: before.revision + 1,
    overview: [...overview].length <= 5000 ? overview : before.overview,
    facts: [
      ...before.facts,
      {
        id: crypto.randomUUID(),
        text: [...request.input.explanation].slice(0, 2000).join(""),
        attribution: "user_statement",
        certainty: "reported",
        significance: "neutral",
        references: [
          {
            kind: "user_message",
            messageId: request.id,
            workspaceRevision: request.input.expectedRevision,
          },
        ],
        conflictingFactIds: [],
        userEdited: false,
      },
    ],
  });
}
export function createReconciliationMock(
  runtime: WorkspaceMockRuntime,
  options: {
    generate?: (
      before: V2Summary,
      request: NonNullable<V2SummaryReconciliation["request"]>,
    ) => V2Summary;
    invalidate?: (state: WorkspaceMockState, caseId: string) => void;
  } = {},
) {
  return async (request: Request): Promise<Response | null> => {
    const match =
      /^\/api\/v2\/cases\/([^/]+)\/rework\/summary-reconciliation(?:\/(request|confirm|cancel))?$/.exec(
        new URL(request.url).pathname,
      );
    if (!match) return null;
    try {
      const id = decodeURIComponent(match[1] ?? ""),
        action = match[2];
      const mutation = request.method === "POST";
      if ((!action && request.method !== "GET") || (action && !mutation))
        return mockResponse({}, 405);
      const body: unknown = mutation ? await request.json() : null;
      const expectedOwner = request.headers.get(EXPECTED_OWNER_HEADER);
      const run = (state: WorkspaceMockState) => {
        const { item, ownerId } = owned(state, id, mutation, expectedOwner);
        const records = (state.summaryReconciliations ?? {}) as Records;
        const saved = records[id] ?? emptyReconciliation(item.revision);
        const current = v2SummaryReconciliationSchema.parse({
          ...saved,
          workspaceRevision: item.revision,
        });
        if (!mutation) {
          if (
            ["pending", "running", "proposed", "failed"].includes(current.status) &&
            saved.workspaceRevision !== item.revision
          )
            return { ...current, status: "stale" as const, currentJobId: null, failure: null };
          return current;
        }
        const key = request.headers.get("idempotency-key");
        if (!key) fail("VALIDATION_ERROR", "요청 키가 필요해요.");
        const receiptKey = `${ownerId}:${id}:${action}:${key}`;
        const receipts = (state.summaryReconciliationReceipts ?? {}) as Record<string, Receipt>;
        const fingerprint = JSON.stringify(body);
        const receipt = receipts[receiptKey];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            fail("CONFLICT", "같은 요청 키의 내용이 달라요.");
          return receipt.value;
        }
        const now = new Date().toISOString();
        let next: V2SummaryReconciliation;
        if (action === "request") {
          const input = v2SummaryReconciliationRequestSchema.parse(body);
          const before = summary(item);
          if (
            item.schemaVersion === "1" ||
            !["summary", "active"].includes(item.stage) ||
            input.expectedRevision !== item.revision ||
            input.summaryRevision !== before.revision ||
            ["pending", "running", "proposed"].includes(current.status)
          )
            fail("CONFLICT", "최신 사건 정리를 확인하고 다시 요청해 주세요.");
          const savedRequest = { id: crypto.randomUUID(), input, createdAt: now };
          const proposal: V2SummaryReconciliationProposal = {
            id: crypto.randomUUID(),
            requestId: savedRequest.id,
            baseWorkspaceRevision: item.revision,
            baseSummaryRevision: before.revision,
            baseIntakeRevision: before.intakeRevision,
            before: structuredClone(before),
            after: (options.generate ?? syntheticProposal)(structuredClone(before), savedRequest),
            reasons: [
              "합성 adapter가 추가 진술을 변경안으로 준비했습니다. 실제 모델 판단이 아닙니다.",
            ],
            createdAt: now,
          };
          next = {
            ...emptyReconciliation(item.revision + 1),
            status: "proposed",
            request: savedRequest,
            proposal,
          };
        } else if (action === "confirm") {
          const input = v2SummaryReconciliationConfirmSchema.parse(body);
          const proposal = current.proposal;
          if (
            !proposal ||
            current.status !== "proposed" ||
            saved.workspaceRevision !== item.revision ||
            input.expectedRevision !== item.revision ||
            input.proposalId !== proposal.id ||
            input.summaryRevision !== proposal.baseSummaryRevision ||
            !sameSummary(summary(item), proposal.before)
          )
            fail("CONFLICT", "사건 내용이 바뀌었어요. 최신 정리를 확인해 주세요.");
          next = {
            ...current,
            workspaceRevision: item.revision + 1,
            status: "confirmed",
            confirmedWorkspaceRevision: item.revision + 1,
            confirmedSummaryRevision: proposal.after.revision,
          };
          item.summary = proposal.after.overview;
          item.summaryDetails = structuredClone(proposal.after);
          item.stage = "active";
          item.summaryNeedsConfirmation = false;
          options.invalidate?.(state, id);
        } else {
          const input = v2SummaryReconciliationCancelSchema.parse(body);
          if (
            !current.request ||
            input.requestId !== current.request.id ||
            input.expectedRevision !== item.revision ||
            !["pending", "running", "proposed", "failed", "stale"].includes(current.status)
          )
            fail("CONFLICT", "취소할 변경 요청을 다시 확인해 주세요.");
          next = {
            ...current,
            workspaceRevision: item.revision + 1,
            status: "cancelled",
            currentJobId: null,
            failure: null,
          };
        }
        next = v2SummaryReconciliationSchema.parse(next);
        item.revision = next.workspaceRevision;
        item.updatedAt = now;
        records[id] = next;
        receipts[receiptKey] = { fingerprint, value: structuredClone(next) };
        state.summaryReconciliations = records;
        state.summaryReconciliationReceipts = receipts;
        return next;
      };
      return mockResponse(mutation ? runtime.update(run) : run(runtime.read()));
    } catch (cause) {
      return mockFailure(cause);
    }
  };
}
const sameSummary = (left: V2Summary, right: V2Summary) =>
  JSON.stringify(left) === JSON.stringify(right);
