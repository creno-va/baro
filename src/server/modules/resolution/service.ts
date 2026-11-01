import { opaqueIdSchema } from "../../../contracts";
import {
  type V2ResolutionBasis,
  type V2ResolutionCheck,
  type V2ResolutionDocumentKind,
  type V2ResolutionDraft,
  type V2ResolutionState,
  v2ResolutionDraftRequestSchema,
  v2ResolutionDraftSchema,
  v2ResolutionMutationSchema,
  v2ResolutionStateForGuidesSchema,
} from "../../../contracts/v2/resolution";

import {
  resolutionDraftIsCurrent,
  resolutionKindFits,
  sameResolutionBasis,
  sameResolutionFiles,
} from "../../../utils/resolution";
import {
  buildResolutionDraftText,
  maskResolutionText,
  resolutionAnalysisIncluded,
  resolutionWeaknessChecks,
  selectedResolutionFacts,
} from "./draft";
import type { ResolutionDependencies, ResolutionSource } from "./types";

export class ResolutionError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "STALE_REVISION"
      | "REVIEW_REQUIRED"
      | "VALIDATION_ERROR"
      | "POLICY_REJECTED"
      | "RESOLUTION_TOO_LARGE",
  ) {
    super(code);
  }
}
const defaultChecks: [string, string, string][] = [
  [
    "order",
    "준비 순서",
    "사건 입장·형사/민사 구분·현재 절차를 확인한 뒤, 사실과 자료를 정리하고 공식 안내에서 제출 요건을 확인해 주세요.",
  ],
  [
    "documents",
    "필요 서류",
    "사건에 맞는 문서 종류와 필요한 첨부 서류를 공식 안내 또는 담당기관에서 확인해 주세요.",
  ],
  [
    "evidence",
    "증거 준비",
    "선택한 자료의 원본·관련 부분·사실과의 관계를 정리하고 불리한 사실도 보존해 주세요.",
  ],
  ["recipient", "제출처", "공식 안내에서 사건의 제출처를 확인해 주세요. 아직 확정하지 않았습니다."],
  [
    "institution",
    "담당기관·부서",
    "공식 안내와 기관 문의로 사건을 담당하는 기관·부서를 확인해 주세요.",
  ],
  [
    "method",
    "제출 방법",
    "해당 사건에서 허용되는 방문·우편·온라인 등 제출 방법을 공식 안내에서 확인해 주세요.",
  ],
  [
    "jurisdiction",
    "관할",
    "사건 종류·당사자·관련 장소에 관한 사실을 확인하고 공식 안내나 담당기관에 관할을 확인해 주세요.",
  ],
  [
    "deadline",
    "기한",
    "실제로 받은 문서와 송달·통지 날짜를 확인해 공식 안내 또는 담당기관에서 기한을 확인해 주세요. 기한을 계산하거나 확정하지 않았습니다.",
  ],
  [
    "form",
    "서식",
    "현재 단계에 맞는 공식 서식과 작성 안내를 확인해 주세요. 확인되지 않은 양식을 제시하지 않았습니다.",
  ],
];
function allowedKinds(source: ResolutionSource): V2ResolutionDocumentKind[] {
  const kinds: V2ResolutionDocumentKind[] = ["fact_statement"];
  if (!source.basis || source.report?.stale) return kinds;
  for (const support of source.documentSupport) {
    if (!resolutionKindFits(support.documentKind, source.basis) || !support.sourceClaimIds.length)
      continue;
    if (
      !support.sourceClaimIds.every((id) => {
        const claim = source.sourceClaims.find((c) => c.id === id);
        return (
          claim &&
          claim.kind === "quotation" &&
          source.citations.some((c) => c.id === claim.citationId && c.kind === "official_guide")
        );
      })
    )
      continue;
    if (!kinds.includes(support.documentKind)) kinds.push(support.documentKind);
  }
  return kinds;
}
function checkScope(
  source: ResolutionSource,
  selectedFileIds: readonly string[],
  maskIdentifiers: boolean,
) {
  if (
    !source.report ||
    selectedFileIds.some(
      (id) =>
        !source.report?.selectedFileIds.includes(id) || !source.files.some((f) => f.id === id),
    )
  )
    throw new ResolutionError("VALIDATION_ERROR");
  if (source.report.maskIdentifiers && !maskIdentifiers)
    throw new ResolutionError("VALIDATION_ERROR");
}
function currentState(source: ResolutionSource, guideHosts: readonly string[]): V2ResolutionState {
  const stored = source.stored;
  const ids = (stored?.selectedFileIds ?? source.report?.selectedFileIds ?? []).filter(
    (id) => source.report?.selectedFileIds.includes(id) && source.files.some((f) => f.id === id),
  );
  const mask = !!source.report?.maskIdentifiers || (stored?.maskIdentifiers ?? false);
  const display = (text: string) => (mask ? maskResolutionText(text, source.maskingTokens) : text);
  const checks: V2ResolutionCheck[] = defaultChecks.map(([id, label, detail]) => ({
    id,
    label,
    detail,
    status: "needs_confirmation",
    sourceClaimIds: [],
  }));
  if (source.context.casePurpose === "respond_to_claim")
    checks.push({
      id: "public-defender",
      label: "국선변호·법률구조 공식 안내",
      detail:
        "국선변호 등의 대상·절차는 현재 단계에 맞는 공식 안내에서 확인해 주세요. 자격·선정·선임을 보장하지 않습니다.",
      status: "needs_confirmation",
      sourceClaimIds: [],
    });
  const analysisIncluded = resolutionAnalysisIncluded(source, ids);
  const visibleClaims = source.sourceClaims.filter(
    (claim) =>
      analysisIncluded ||
      (claim.kind === "quotation" &&
        source.citations.some((c) => c.id === claim.citationId && c.kind === "official_guide")),
  );
  // Do not upgrade unsupported checks just because a caller labels them verified.
  for (const check of source.procedureChecks) {
    const valid =
      check.status !== "verified" ||
      (check.sourceClaimIds.length > 0 &&
        check.sourceClaimIds.every((id) =>
          visibleClaims.some(
            (claim) => claim.id === id && source.citations.some((c) => c.id === claim.citationId),
          ),
        ));
    if (!valid) continue;
    const index = checks.findIndex((c) => c.id === check.id);
    if (index >= 0) checks[index] = check;
    else checks.push(check);
  }
  const stale =
    !!source.report?.stale || (!!stored?.basis && !sameResolutionBasis(stored.basis, source.basis));
  const state: V2ResolutionState = {
    contractVersion: "conversation-report-v1",
    revision: stored?.revision ?? 1,
    basis: source.basis ?? stored?.basis ?? stored?.draft?.basis ?? null,
    selection: stored?.selection ?? null,
    selectedFileIds: ids,
    maskIdentifiers: mask,
    status: !source.basis
      ? "not_ready"
      : stale
        ? "stale"
        : stored?.status === "paused"
          ? "paused"
          : "active",
    draft: stored?.draft ?? null,
    procedureChecks: checks.slice(0, 100).map((c) => ({ ...c, detail: display(c.detail) })),
    weaknessChecks: resolutionWeaknessChecks(source, ids).map(display),
    consultationPreparation: [
      "상담할 내용과 이번에 확인할 절차·미확인 사항을 정리해 주세요.",
      ...selectedResolutionFacts(source, ids).map((fact) => display(fact.text)),
      ...source.files
        .filter((f) => ids.includes(f.id))
        .map((f) => `선택한 자료: ${display(f.name)}`),
      "선택한 범위를 검토한 뒤 사용자가 직접 전달합니다. 자료나 사건 접근권한을 자동 전송하지 않습니다.",
    ]
      .slice(0, 100)
      .map((text) => text.slice(0, 2000)),
    citations: source.citations.filter((c) =>
      visibleClaims.some((claim) => claim.citationId === c.id),
    ),
    sourceClaims: visibleClaims,
    allowedDocumentKinds: allowedKinds(source),
  };
  return v2ResolutionStateForGuidesSchema(guideHosts).parse(state);
}
/** No model, legal lookup, submission, contact or browser storage occurs on read/select/save. */
export function createResolutionService(deps: ResolutionDependencies) {
  async function load(ownerId: string, caseId: string, mode: "read" | "write" = "read") {
    opaqueIdSchema.parse(ownerId);
    opaqueIdSchema.parse(caseId);
    if (!(await deps.authorize(ownerId, caseId, null, mode)))
      throw new ResolutionError("NOT_FOUND");
    const source = await deps.load(ownerId, caseId);
    if (!(await deps.authorize(ownerId, caseId, source.basis, mode)))
      throw new ResolutionError("NOT_FOUND");
    return { source, state: currentState(source, deps.guideHosts) };
  }
  function match(
    state: V2ResolutionState,
    source: ResolutionSource,
    input: { expectedRevision: number; reportId: string; reportRevision: number },
  ) {
    if (
      state.revision !== input.expectedRevision ||
      source.report?.id !== input.reportId ||
      source.report.revision !== input.reportRevision
    )
      throw new ResolutionError("STALE_REVISION");
  }
  async function commit(
    ownerId: string,
    caseId: string,
    state: V2ResolutionState,
    expectedRevision: number,
    basis: V2ResolutionBasis | null,
  ) {
    const result = v2ResolutionStateForGuidesSchema(deps.guideHosts).parse({
      ...state,
      revision: expectedRevision + 1,
    });
    if (!(await deps.authorize(ownerId, caseId, basis, "write")))
      throw new ResolutionError("NOT_FOUND");
    if (!(await deps.saveCAS(ownerId, caseId, { expectedRevision, basis, state: result })))
      throw new ResolutionError("STALE_REVISION");
    if (!(await deps.authorize(ownerId, caseId, basis, "write")))
      throw new ResolutionError("NOT_FOUND");
    return result;
  }
  return {
    async get(ownerId: string, caseId: string) {
      return (await load(ownerId, caseId)).state;
    },
    async update(ownerId: string, caseId: string, raw: unknown) {
      const input = v2ResolutionMutationSchema.parse(raw);
      const { source, state } = await load(ownerId, caseId, "write");
      match(state, source, input);
      let next = { ...state };
      if (input.action === "select") {
        checkScope(source, input.selectedFileIds, input.maskIdentifiers);
        next = {
          ...state,
          selection: input.choice,
          selectedFileIds: input.selectedFileIds,
          maskIdentifiers: input.maskIdentifiers,
          status: state.basis && !source.report?.stale ? "active" : "not_ready",
        };
        // Scope-dependent preparation is always rebuilt; no old analysis survives exclusions.
        const projected = currentState({ ...source, stored: next }, deps.guideHosts);
        next = { ...projected, status: next.status };
      } else if (input.action === "pause") next.status = state.basis ? "paused" : "not_ready";
      else if (input.action === "resume")
        next.status = !state.basis ? "not_ready" : source.report?.stale ? "stale" : "active";
      else {
        const draft = state.draft;
        if (
          !draft ||
          draft.id !== input.draftId ||
          draft.revision !== input.draftRevision ||
          !resolutionDraftIsCurrent(state) ||
          state.status === "paused"
        )
          throw new ResolutionError("STALE_REVISION");
        const content = state.maskIdentifiers
          ? maskResolutionText(input.content, source.maskingTokens)
          : input.content;
        next.draft = v2ResolutionDraftSchema.parse({
          ...draft,
          content,
          revision: draft.revision + 1,
          reviewed: true,
          status: "saved",
          userEdited: draft.userEdited || content !== draft.content,
          updatedAt: deps.now(),
        });
      }
      return commit(ownerId, caseId, next, state.revision, source.basis);
    },
    async prepareDraft(ownerId: string, caseId: string, raw: unknown) {
      const request = v2ResolutionDraftRequestSchema.parse(raw);
      const { source, state } = await load(ownerId, caseId, "write");
      match(state, source, request);
      if (
        !state.basis ||
        !source.basis ||
        source.report?.stale ||
        state.selection !== "self" ||
        state.status === "paused"
      )
        throw new ResolutionError("REVIEW_REQUIRED");
      checkScope(source, request.selectedFileIds, request.maskIdentifiers);
      if (!state.allowedDocumentKinds.includes(request.documentKind))
        throw new ResolutionError("POLICY_REJECTED");
      const text = buildResolutionDraftText(source, request);
      if (text.content.length > 20000) throw new ResolutionError("RESOLUTION_TOO_LARGE");
      const now = deps.now();
      const template: V2ResolutionDraft = v2ResolutionDraftSchema.parse({
        ...text,
        id: deps.newId(),
        revision: 1,
        documentKind: request.documentKind,
        basis: state.basis,
        selectedFileIds: request.selectedFileIds,
        maskIdentifiers: request.maskIdentifiers,
        userEdited: false,
        reviewed: false,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
      let draft = template;
      if (deps.auditedDraft) {
        const display = (text: string) =>
          request.maskIdentifiers ? maskResolutionText(text, source.maskingTokens) : text;
        const safeClaims = source.sourceClaims.filter((c) => c.kind === "quotation");
        const minimized: ResolutionSource = {
          ...source,
          stored: null,
          analysis: null,
          context: {
            ...source.context,
            procedure: {
              ...source.context.procedure,
              description: source.context.procedure.description
                ? display(source.context.procedure.description)
                : null,
            },
          },
          facts: selectedResolutionFacts(source, request.selectedFileIds).map((f) => ({
            ...f,
            text: display(f.text),
          })),
          files: source.files
            .filter((f) => request.selectedFileIds.includes(f.id))
            .map((f) => ({ ...f, name: display(f.name), text: display(f.text) })),
          report: source.report
            ? {
                ...source.report,
                selectedFileIds: request.selectedFileIds,
                maskIdentifiers: request.maskIdentifiers,
              }
            : null,
          citations: source.citations.filter((c) =>
            safeClaims.some((claim) => claim.citationId === c.id),
          ),
          sourceClaims: safeClaims,
          procedureChecks: [],
          documentSupport: [],
          maskingTokens: [],
        };
        draft = v2ResolutionDraftSchema.parse(
          await deps.auditedDraft({ source: minimized, request, template }),
        );
        if (
          draft.id !== template.id ||
          draft.documentKind !== request.documentKind ||
          !sameResolutionBasis(draft.basis, state.basis) ||
          !sameResolutionFiles(draft.selectedFileIds, request.selectedFileIds) ||
          draft.maskIdentifiers !== request.maskIdentifiers ||
          draft.revision !== 1 ||
          draft.createdAt !== template.createdAt ||
          draft.userEdited ||
          template.missingFields.some(
            (field) =>
              !draft.missingFields.includes(field) || !draft.content.includes(`[미입력: ${field}]`),
          ) ||
          draft.reviewed ||
          draft.status !== "draft"
        )
          throw new ResolutionError("POLICY_REJECTED");
        if (request.maskIdentifiers)
          draft = {
            ...draft,
            title: maskResolutionText(draft.title, source.maskingTokens),
            content: maskResolutionText(draft.content, source.maskingTokens),
          };
      }
      // The async gateway can outlive a revision or authorization; final CAS rechecks both.
      const latest = await load(ownerId, caseId, "write");
      if (
        latest.state.revision !== state.revision ||
        !sameResolutionBasis(latest.source.basis, source.basis) ||
        latest.source.report?.stale
      )
        throw new ResolutionError("STALE_REVISION");
      return commit(
        ownerId,
        caseId,
        currentState(
          {
            ...latest.source,
            stored: {
              ...state,
              status: "active",
              selectedFileIds: request.selectedFileIds,
              maskIdentifiers: request.maskIdentifiers,
              draft,
            },
          },
          deps.guideHosts,
        ),
        state.revision,
        source.basis,
      );
    },
  };
}
