import { opaqueIdSchema } from "../../../contracts";
import {
  type V2ConversationActionRequest,
  type V2ConversationActionResult,
  type V2ConversationState,
  v2ConversationActionRequestSchema,
  v2ConversationActionResultSchema,
  v2ConversationStateSchema,
  v2ReworkVersionSchema,
} from "../../../contracts/v2";

export class ConversationAgentError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONSENT_REQUIRED" | "INVALID_STATE" | "STALE_REVISION",
  ) {
    super(code);
  }
}

export type ConversationExecution = {
  ownerId: string;
  caseId: string;
  request: V2ConversationActionRequest;
};
export type ConversationAdmission = { operationId: string | null; workspaceRevision: number };
export type ConversationAgentDependencies = {
  guideHosts?: readonly string[];
  /** Lightweight current owner/consent/deletion check, including receipt replays. */
  authorize: (ownerId: string, caseId: string) => Promise<boolean>;
  /** A fresh owner/consent/deletion/revision snapshot, never browser-supplied state. */
  load: (
    ownerId: string,
    caseId: string,
  ) => Promise<{
    state: V2ConversationState;
    canMutate: boolean;
    archived: boolean;
    workspaceJobId: string | null;
  } | null>;
  /** Central durable receipt: bind owner, case, request ID and complete input hash.
   * Replays resolve the original operation, including after an ambiguous timeout. */
  once: (
    input: ConversationExecution,
    work: () => Promise<V2ConversationActionResult>,
  ) => Promise<V2ConversationActionResult>;
  /** Admit/reuse a separate bounded analysis job. A report continuation is durable;
   * it is not a new analysis call and does not depend on an open browser. */
  analyze: (
    input: ConversationExecution,
    options: { continueWithReport: boolean },
  ) => Promise<ConversationAdmission>;
  prepareReport: (input: ConversationExecution) => Promise<ConversationAdmission>;
  selectResolution: (
    input: ConversationExecution & {
      request: Extract<V2ConversationActionRequest, { action: "resolve_followup" }> & {
        choice: "self" | "lawyer" | "save_report";
      };
    },
  ) => Promise<ConversationAdmission>;
};

/** This dispatcher has no model, arbitrary API, SQL or external-contact capability.
 * The router supplies authenticated adapters to the existing domain services. */
export function createConversationAgent(deps: ConversationAgentDependencies) {
  const stateSchema = v2ConversationStateSchema(deps.guideHosts);
  return {
    async execute(ownerId: string, caseId: string, raw: unknown) {
      opaqueIdSchema.parse(ownerId);
      opaqueIdSchema.parse(caseId);
      const request = v2ConversationActionRequestSchema.parse(raw);
      const input = { ownerId, caseId, request };
      if (!(await deps.authorize(ownerId, caseId))) throw new ConversationAgentError("NOT_FOUND");
      const response = await deps.once(input, async () => {
        const loaded = await deps.load(ownerId, caseId);
        if (!loaded) throw new ConversationAgentError("NOT_FOUND");
        const state = stateSchema.parse(loaded.state);
        if (!loaded.canMutate) throw new ConversationAgentError("CONSENT_REQUIRED");
        if (loaded.archived) throw new ConversationAgentError("INVALID_STATE");
        if (state.workspaceRevision !== request.expectedRevision)
          throw new ConversationAgentError("STALE_REVISION");
        const result = (
          pane: V2ConversationActionResult["pane"],
          status: V2ConversationActionResult["status"],
          missingItems: string[] = [],
          admission?: ConversationAdmission,
        ) =>
          v2ConversationActionResultSchema.parse({
            contractVersion: v2ReworkVersionSchema.value,
            requestId: request.requestId,
            workspaceRevision: admission?.workspaceRevision ?? state.workspaceRevision,
            pane,
            status,
            missingItems,
            operationId: admission?.operationId ?? null,
          });
        switch (request.action) {
          case "add_material":
            return result("materials", "require_confirmation");
          case "reconfirm_case":
            return result("reconfirmation", "require_confirmation");
          case "show_preparation":
            return result("preparation", "ready");
          case "open_lawyers":
            // Only opens the existing user-controlled follow-up UI.
            return result("lawyers", "require_confirmation");
          case "save_report":
            if (
              state.report.id !== request.reportId ||
              state.report.revision !== request.reportRevision
            )
              throw new ConversationAgentError("STALE_REVISION");
            return result(
              "report",
              "require_confirmation",
              state.report.status === "stale"
                ? [
                    "사건이나 자료가 바뀌었어요. 검토한 이전 버전과 최신 버전을 구분해 저장해 주세요.",
                  ]
                : [],
            );
          case "resolve_followup":
            if (!request.choice) return result("followup", "require_confirmation");
            if (state.report.status !== "ready")
              return result("report", "blocked", ["현재 사건 기준의 리포트를 먼저 검토해 주세요."]);
            return result(
              "followup",
              "ready",
              [],
              await deps.selectResolution({
                ...input,
                request: { ...request, choice: request.choice },
              }),
            );
          case "analyze_legal":
          case "prepare_report": {
            const reporting = request.action === "prepare_report";
            if (!state.summaryConfirmed)
              return result("reconfirmation", "require_confirmation", [
                "현재 사건 정리를 확인해 주세요.",
              ]);
            if (state.pendingEvidenceIds.length)
              return result("materials", "blocked", [
                `자료 ${state.pendingEvidenceIds.length}개의 처리가 끝나지 않았어요. 처리 결과를 확인한 뒤 이어갈 수 있어요.`,
              ]);
            const analysisPending = ["pending", "running"].includes(state.analysis.status);
            if (loaded.workspaceJobId && !analysisPending)
              return result(
                reporting ? "report" : "analysis",
                "pending",
                ["진행 중인 작업의 결과를 먼저 확인하고 있어요."],
                { operationId: loaded.workspaceJobId, workspaceRevision: state.workspaceRevision },
              );
            if (analysisPending && !reporting)
              return result("analysis", "pending", state.analysis.missingItems, {
                operationId: state.analysis.currentJobId,
                workspaceRevision: state.workspaceRevision,
              });
            if (
              analysisPending ||
              state.analysis.status === "not_started" ||
              state.analysis.status === "stale" ||
              (!reporting && state.analysis.status === "failed")
            )
              return result(
                reporting ? "report" : "analysis",
                "pending",
                state.analysis.missingItems,
                await deps.analyze(input, { continueWithReport: reporting }),
              );
            if (!reporting) return result("analysis", "ready", state.analysis.missingItems);
            if (state.report.status === "ready") return result("report", "ready");
            if (state.report.status === "pending")
              return result("report", "pending", state.analysis.missingItems, {
                operationId: state.report.currentJobId,
                workspaceRevision: state.workspaceRevision,
              });
            // Partial/empty/unavailable analysis permits an honestly limited factual
            // report. The report service preserves gaps and snapshots; no retry loop.
            const admission = await deps.prepareReport(input);
            const prepared = admission.operationId ? null : await deps.load(ownerId, caseId);
            return result(
              "report",
              admission.operationId
                ? "pending"
                : prepared?.state.report.status === "ready"
                  ? "ready"
                  : "blocked",
              admission.operationId || prepared?.state.report.status === "ready"
                ? state.analysis.missingItems
                : [
                    ...state.analysis.missingItems,
                    "리포트의 저장 결과를 아직 확인하지 못했어요. 같은 요청의 상태를 다시 확인해 주세요.",
                  ],
              admission,
            );
          }
        }
      });
      if (!(await deps.authorize(ownerId, caseId))) throw new ConversationAgentError("NOT_FOUND");
      const validated = v2ConversationActionResultSchema.parse(response);
      if (
        validated.requestId !== request.requestId ||
        validated.workspaceRevision < request.expectedRevision ||
        (validated.status === "pending" && validated.operationId === null)
      )
        throw new ConversationAgentError("INVALID_STATE");
      return validated;
    },
  };
}
