import { createJsonRequester } from "@baro/api-client";

export { responseError } from "@baro/api-client";
export { cacheClient } from "@baro/client-core";

import { ApiError } from "./errors";
import { mockRequest } from "./mock/runtime";

export { ApiError, errorMessage } from "./errors";
export { registerMockHandlers } from "./mock/runtime";
export const apiMode: "mock" | "real" =
  import.meta.env.PUBLIC_API_MODE === "mock" ? "mock" : "real";
let mockHandlersReady: Promise<void> | undefined;
export interface RequestOptions {
  path?: string;
  method?: string;
  body?: unknown;
  key?: string;
  signal?: AbortSignal;
}
export async function request<T>(
  operation: string,
  input?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const key = options.key ?? crypto.randomUUID();
  if (import.meta.env.PUBLIC_API_MODE === "mock") {
    mockHandlersReady ??= Promise.all([import("./mock/session"), import("./mock/cases")])
      .then(() => undefined)
      .catch((error) => {
        mockHandlersReady = undefined;
        throw error;
      });
    await mockHandlersReady;
    return mockRequest<T>(operation, input, key);
  }
  if (!options.path) throw new ApiError("UNAVAILABLE", "실제 API 연결을 준비하고 있어요.", true);
  return realRequest<T>({ ...options, path: options.path, key });
}

const realRequest = createJsonRequester({
  transport: (path, init) => fetch(path, { ...init, credentials: "same-origin" }),
  newKey: () => crypto.randomUUID(),
  encodeBody: (value) =>
    value instanceof FormData
      ? { body: value }
      : { body: JSON.stringify(value), contentType: "application/json" },
});

export type HttpMockHandler = (request: Request) => Promise<Response | null>;
const httpMocks: HttpMockHandler[] = [];
export function registerHttpMockHandler(handler: HttpMockHandler) {
  httpMocks.push(handler);
}
export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/api/"))
    throw new ApiError("VALIDATION_ERROR", "요청 경로를 확인해 주세요.");
  if (apiMode === "real") {
    try {
      return await fetch(path, { ...init, credentials: "same-origin" });
    } catch {
      throw new ApiError("UNAVAILABLE", "연결하지 못했어요. 다시 시도해 주세요.", true);
    }
  }
  const incoming = new Request(
    new URL(path, typeof location === "undefined" ? "http://localhost" : location.origin),
    init,
  );
  for (const handler of httpMocks) {
    const result = await handler(incoming.clone() as unknown as Request);
    if (result) return result;
  }
  return Response.json(
    { error: { code: "UNAVAILABLE", message: "API 연결을 준비하고 있어요.", retryable: true } },
    { status: 503 },
  );
}
