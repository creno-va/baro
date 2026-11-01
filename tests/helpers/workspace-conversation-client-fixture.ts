import { ApiError } from "../../src/client/api/core";
import type { WorkspaceMockRuntime } from "../../src/client/api/mock/workspace";
import type { ConversationClient } from "../../src/components/workspace/ConversationAgent";
import {
  v2ConversationActionRequestSchema,
  v2ConversationStateSchema,
} from "../../src/contracts/v2";
import { conversationState } from "./conversation-state";

/** Isolated UI reads. No simulated paid analysis/report success or production fallback. */
export function workspaceConversationFixture(runtime: WorkspaceMockRuntime): ConversationClient {
  return {
    async getConversation(id, options) {
      options?.signal?.throwIfAborted();
      const saved = runtime.read();
      const owner = saved.session.user?.id;
      if (!owner || (options?.expectedOwner && options.expectedOwner !== owner))
        throw new ApiError("UNAUTHENTICATED", "이용 계정이 바뀌었어요.");
      const item = saved.cases[id];
      if (
        !item ||
        (saved.caseOwners?.[id] ?? "synthetic-owner") !== owner ||
        saved.deletedCaseIds?.includes(id)
      )
        throw new ApiError("NOT_FOUND", "사건을 확인할 수 없어요.");
      const state = conversationState("unconfirmed");
      state.workspaceRevision = item.revision;
      state.caseContext.subjectContext = item.subjectContext;
      state.summaryConfirmed = item.stage === "active";
      state.pendingEvidenceIds = (saved.files[id] ?? [])
        .filter(
          (file) =>
            !file.uploadRejection && ["uploading", "processing", "waiting"].includes(file.status),
        )
        .map((file) => file.id);
      return v2ConversationStateSchema().parse(state);
    },
    async executeAction(id, raw, options) {
      const state = await this.getConversation(id, options);
      const request = v2ConversationActionRequestSchema.parse(raw);
      if (runtime.read().session.needsConsent)
        throw new ApiError("CONSENT_REQUIRED", "현재 동의를 확인해 주세요.");
      if (request.expectedRevision !== state.workspaceRevision)
        throw new ApiError("CONFLICT", "최신 사건 상태를 확인해 주세요.");
      const panes = {
        add_material: "materials",
        reconfirm_case: "reconfirmation",
        show_preparation: "preparation",
        analyze_legal: "analysis",
        prepare_report: "report",
        resolve_followup: "followup",
        save_report: "report",
        open_lawyers: "lawyers",
      } as const;
      if (["analyze_legal", "prepare_report"].includes(request.action))
        throw new ApiError(
          "UNAVAILABLE",
          "이 격리 UI 검사는 실제 법률 조사·리포트 실행을 제공하지 않아요.",
        );
      return {
        contractVersion: "conversation-report-v1",
        requestId: request.requestId,
        workspaceRevision: state.workspaceRevision,
        pane: panes[request.action],
        status: request.action === "show_preparation" ? "ready" : "require_confirmation",
        missingItems: [],
        operationId: null,
      };
    },
  };
}
