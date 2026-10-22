import type { SessionScope } from "@baro/client-core";
import { opaqueIdSchema } from "@baro/contracts/common";
import {
  type V2PrecedentReadRequest,
  type V2PrecedentSearchRequest,
  v2PrecedentReadRequestSchema,
  v2PrecedentReadResponseSchema,
  v2PrecedentResearchContextSchema,
  v2PrecedentSearchRequestSchema,
  v2PrecedentSearchResponseSchema,
} from "@baro/contracts/v2/precedent-research";
import { ApiError } from "./errors";
import type { OperationRequest } from "./http";

export function createPrecedentsClient(dependencies: {
  request: OperationRequest;
  scope: SessionScope;
}) {
  const generation = dependencies.scope.snapshot(),
    signal = dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  async function call(
    action: "context" | "search" | "read",
    id: string,
    body?: unknown,
    abort?: AbortSignal,
  ) {
    ensureCurrent();
    const caseId = opaqueIdSchema.parse(id);
    const requestSignal = abort ? AbortSignal.any([abort, signal]) : signal;
    requestSignal.throwIfAborted();
    try {
      const value = await dependencies.request<unknown>(
        `precedents.${action}`,
        { id: caseId, body },
        {
          path: `/api/v2/cases/${encodeURIComponent(caseId)}/precedents${action === "context" ? "" : `/${action}`}`,
          method: action === "context" ? "GET" : "POST",
          ...(body === undefined ? {} : { body }),
          signal: requestSignal,
        },
      );
      ensureCurrent();
      requestSignal.throwIfAborted();
      return value;
    } catch (error) {
      ensureCurrent();
      requestSignal.throwIfAborted();
      throw error;
    }
  }
  return {
    context: async (id: string, signal?: AbortSignal) =>
      v2PrecedentResearchContextSchema.parse(await call("context", id, undefined, signal)),
    search: async (id: string, body: V2PrecedentSearchRequest, signal?: AbortSignal) =>
      v2PrecedentSearchResponseSchema.parse(
        await call("search", id, v2PrecedentSearchRequestSchema.parse(body), signal),
      ),
    read: async (id: string, body: V2PrecedentReadRequest, signal?: AbortSignal) =>
      v2PrecedentReadResponseSchema.parse(
        await call("read", id, v2PrecedentReadRequestSchema.parse(body), signal),
      ),
  };
}
