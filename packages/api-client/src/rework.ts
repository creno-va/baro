import type { CaseView, SessionScope, SessionView } from "@baro/client-core";
import { idempotencyKeySchema, opaqueIdSchema } from "@baro/contracts/common";
import {
  type V2CaseContextUpdate,
  type V2ConversationActionRequest,
  type V2ResolutionDraftRequest,
  type V2ResolutionMutation,
  type V2SummaryReconciliationCancel,
  type V2SummaryReconciliationConfirm,
  type V2SummaryReconciliationRequest,
  v2CaseContextUpdateSchema,
  v2CaseContextViewSchema,
  v2ConversationActionRequestSchema,
  v2ConversationActionResultSchema,
  v2ConversationStateSchema,
  v2ResolutionDraftRequestSchema,
  v2ResolutionMutationSchema,
  v2ResolutionStateForGuidesSchema,
  v2ReworkCreateCaseRequestSchema,
  v2ReworkCreateCaseResponseSchema,
  v2SummaryReconciliationCancelSchema,
  v2SummaryReconciliationConfirmSchema,
  v2SummaryReconciliationRequestSchema,
  v2SummaryReconciliationSchema,
} from "@baro/contracts/v2";
import { z } from "zod";
import { decode } from "./decode";
import { ApiError } from "./errors";
import type { OperationRequest } from "./http";
import { reportViewSchema } from "./reports";

const createInputSchema = v2ReworkCreateCaseRequestSchema.omit({
  turnstileToken: true,
  jurisdiction: true,
});
export type ReworkCreateInput = z.infer<typeof createInputSchema>;
export const reworkReportViewSchema = reportViewSchema.extend({
  analysisReview: z
    .object({
      analysisId: opaqueIdSchema.nullable(),
      status: z.enum(["ready", "partial", "empty", "unavailable", "review_required"]),
      userEdited: z.boolean(),
      checkedAt: z.iso.datetime().nullable(),
    })
    .optional(),
});
export type ReworkReportView = z.infer<typeof reworkReportViewSchema>;
export type ReworkRequestOptions = { expectedOwner?: string; signal?: AbortSignal };
export interface ReworkKeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The new namespace is opt-in; native clients keep every installed v1/v2 DTO. */
export function createReworkClient(deps: {
  request: OperationRequest;
  session: () => Promise<SessionView>;
  scope: SessionScope;
  challenge: (signal: AbortSignal) => Promise<string>;
  fingerprint: (input: string) => Promise<string>;
  newKey: () => string;
  guideHosts?: readonly string[];
  keyStorage?: ReworkKeyStorage;
}) {
  const generation = deps.scope.snapshot(),
    signal = deps.scope.signal();
  const pendingKeys = new Map<string, string>();
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!deps.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
  };
  const session = async (mutation: boolean) => {
    assertCurrent();
    const value = await deps.session();
    assertCurrent();
    if (!value.user || !["customer", "lawyer"].includes(value.user.accountType))
      throw new ApiError("UNAUTHENTICATED", "현재 계정으로 다시 로그인해 주세요.");
    if (mutation && value.needsConsent)
      throw new ApiError("CONSENT_REQUIRED", "현재 정책에 동의해 주세요.");
    return value;
  };
  const invoke = async <T>(
    operation: string,
    path: string,
    schema: z.ZodType<T>,
    input?: unknown,
    method = "GET",
    fixedKey?: string,
    options: ReworkRequestOptions = {},
  ): Promise<T> => {
    options.signal?.throwIfAborted();
    const before = await session(method !== "GET");
    const owner = before.user?.id;
    if (!owner) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
    if (options.expectedOwner !== undefined && options.expectedOwner !== owner)
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
    const identityInput =
      operation === "rework.createCase" && input && typeof input === "object"
        ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "turnstileToken"))
        : input;
    const identity =
      method === "GET"
        ? null
        : await deps.fingerprint(JSON.stringify([owner, path, identityInput]));
    const storageKey = identity ? `baro-rework-key:${identity}` : null;
    let key: string | undefined;
    if (storageKey) {
      key =
        (fixedKey
          ? await deps.fingerprint(JSON.stringify(["action", owner, fixedKey]))
          : undefined) ??
        pendingKeys.get(storageKey) ??
        deps.keyStorage?.getItem(storageKey) ??
        deps.newKey();
      if (!idempotencyKeySchema.safeParse(key).success)
        throw new ApiError("UNAVAILABLE", "작업 복구 정보를 확인해 주세요.", true);
      pendingKeys.set(storageKey, key);
      deps.keyStorage?.setItem(storageKey, key);
    }
    assertCurrent();
    const result = await deps.request<unknown>(operation, input, {
      path,
      method,
      ...(input === undefined ? {} : { body: input }),
      ...(key ? { key } : {}),
      expectedOwner: owner,
      signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
    });
    assertCurrent();
    options.signal?.throwIfAborted();
    const after = await session(method !== "GET");
    if (after.user?.id !== owner || after.user.accountType !== before.user?.accountType)
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
    const decoded = decode(schema, result);
    if (storageKey) {
      pendingKeys.delete(storageKey);
      deps.keyStorage?.removeItem(storageKey);
    }
    return decoded;
  };
  const path = (id: string, suffix: string) =>
    `/api/v2/cases/${encodeURIComponent(opaqueIdSchema.parse(id))}/rework/${suffix}`;
  const mutate = <T>(
    operation: string,
    id: string,
    suffix: string,
    schema: z.ZodType<T>,
    input: unknown,
    method = "POST",
    key?: string,
    options?: ReworkRequestOptions,
  ) => invoke(operation, path(id, suffix), schema, input, method, key, options);
  return {
    async createCase(
      raw: ReworkCreateInput,
      options: ReworkRequestOptions = {},
    ): Promise<CaseView> {
      const input = createInputSchema.parse(raw);
      const initial = await session(true);
      const expectedOwner = options.expectedOwner ?? initial.user?.id;
      if (!expectedOwner) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
      const token = await deps.challenge(signal);
      const result = await invoke(
        "rework.createCase",
        "/api/v2/cases/rework",
        v2ReworkCreateCaseResponseSchema,
        { ...input, jurisdiction: "KR", turnstileToken: token },
        "POST",
        undefined,
        { ...options, expectedOwner },
      );
      const w = result.workspace;
      return {
        id: w.id,
        title: w.title,
        subjectContext: w.subjectContext,
        stage: w.status,
        revision: w.workspaceRevision,
        updatedAt: w.updatedAt,
        summary: "",
        schemaVersion: "2",
      };
    },
    getContext: (id: string, options?: ReworkRequestOptions) =>
      invoke(
        "rework.getContext",
        path(id, "context"),
        v2CaseContextViewSchema,
        undefined,
        "GET",
        undefined,
        options,
      ),
    updateContext: (id: string, raw: V2CaseContextUpdate, options?: ReworkRequestOptions) =>
      mutate(
        "rework.updateContext",
        id,
        "context",
        v2CaseContextViewSchema,
        v2CaseContextUpdateSchema.parse(raw),
        "PUT",
        undefined,
        options,
      ),
    getReconciliation: (id: string, options?: ReworkRequestOptions) =>
      invoke(
        "rework.getReconciliation",
        path(id, "summary-reconciliation"),
        v2SummaryReconciliationSchema,
        undefined,
        "GET",
        undefined,
        options,
      ),
    requestReconciliation: (
      id: string,
      raw: V2SummaryReconciliationRequest,
      options?: ReworkRequestOptions,
    ) =>
      mutate(
        "rework.requestReconciliation",
        id,
        "summary-reconciliation/request",
        v2SummaryReconciliationSchema,
        v2SummaryReconciliationRequestSchema.parse(raw),
        "POST",
        undefined,
        options,
      ),
    confirmReconciliation: (
      id: string,
      raw: V2SummaryReconciliationConfirm,
      options?: ReworkRequestOptions,
    ) =>
      mutate(
        "rework.confirmReconciliation",
        id,
        "summary-reconciliation/confirm",
        v2SummaryReconciliationSchema,
        v2SummaryReconciliationConfirmSchema.parse(raw),
        "POST",
        undefined,
        options,
      ),
    cancelReconciliation: (
      id: string,
      raw: V2SummaryReconciliationCancel,
      options?: ReworkRequestOptions,
    ) =>
      mutate(
        "rework.cancelReconciliation",
        id,
        "summary-reconciliation/cancel",
        v2SummaryReconciliationSchema,
        v2SummaryReconciliationCancelSchema.parse(raw),
        "POST",
        undefined,
        options,
      ),
    getConversation: (id: string, options?: ReworkRequestOptions) =>
      invoke(
        "rework.getConversation",
        path(id, "conversation"),
        v2ConversationStateSchema(deps.guideHosts),
        undefined,
        "GET",
        undefined,
        options,
      ),
    executeAction: (
      id: string,
      raw: V2ConversationActionRequest,
      options?: ReworkRequestOptions,
    ) => {
      const input = v2ConversationActionRequestSchema.parse(raw);
      return mutate(
        "rework.executeAction",
        id,
        "actions",
        v2ConversationActionResultSchema,
        input,
        "POST",
        input.requestId,
        options,
      );
    },
    getResolution: (id: string, options?: ReworkRequestOptions) =>
      invoke(
        "rework.getResolution",
        path(id, "resolution"),
        v2ResolutionStateForGuidesSchema(deps.guideHosts),
        undefined,
        "GET",
        undefined,
        options,
      ),
    updateResolution: (id: string, raw: V2ResolutionMutation, options?: ReworkRequestOptions) =>
      mutate(
        "rework.updateResolution",
        id,
        "resolution",
        v2ResolutionStateForGuidesSchema(deps.guideHosts),
        v2ResolutionMutationSchema.parse(raw),
        "PATCH",
        undefined,
        options,
      ),
    prepareDraft: (id: string, raw: V2ResolutionDraftRequest, options?: ReworkRequestOptions) =>
      mutate(
        "rework.prepareDraft",
        id,
        "resolution/draft",
        v2ResolutionStateForGuidesSchema(deps.guideHosts),
        v2ResolutionDraftRequestSchema.parse(raw),
        "POST",
        undefined,
        options,
      ),
    peekReport: (id: string, options?: ReworkRequestOptions) =>
      invoke(
        "rework.peekReport",
        path(id, "report"),
        reworkReportViewSchema.nullable(),
        undefined,
        "GET",
        undefined,
        options,
      ),
  };
}
export type ReworkClient = ReturnType<typeof createReworkClient>;
