import {
  type V2PrecedentReadRequest,
  type V2PrecedentSearchRequest,
  v2PrecedentReadResponseSchema,
  v2PrecedentResearchContextSchema,
  v2PrecedentSearchResponseSchema,
} from "../../contracts/v2/precedent-research";
import { request } from "./core";

let mockReady: Promise<unknown> | undefined;
async function call(
  action: "context" | "search" | "read",
  id: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  if (import.meta.env.PUBLIC_API_MODE === "mock") {
    mockReady ??= import("./mock/precedents").catch((error) => {
      mockReady = undefined;
      throw error;
    });
    await mockReady;
  }
  return request<unknown>(
    `precedents.${action}`,
    { id, body },
    {
      path: `/api/v2/cases/${encodeURIComponent(id)}/precedents${action === "context" ? "" : `/${action}`}`,
      method: action === "context" ? "GET" : "POST",
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    },
  );
}
export const precedentsApi = {
  context: async (id: string, signal?: AbortSignal) =>
    v2PrecedentResearchContextSchema.parse(await call("context", id, undefined, signal)),
  search: async (id: string, body: V2PrecedentSearchRequest, signal?: AbortSignal) =>
    v2PrecedentSearchResponseSchema.parse(await call("search", id, body, signal)),
  read: async (id: string, body: V2PrecedentReadRequest, signal?: AbortSignal) =>
    v2PrecedentReadResponseSchema.parse(await call("read", id, body, signal)),
};
