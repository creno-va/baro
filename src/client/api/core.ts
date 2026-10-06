import { ApiError } from "./errors";
import { mockRequest } from "./mock/runtime";

export { ApiError, errorMessage } from "./errors";
export { registerMockHandlers } from "./mock/runtime";
export const apiMode: "mock" | "real" =
  import.meta.env.PUBLIC_API_MODE === "mock" ? "mock" : "real";
export interface RequestOptions {
  path?: string;
  method?: string;
  body?: unknown;
  key?: string;
}
export async function request<T>(
  operation: string,
  input?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const key = options.key ?? crypto.randomUUID();
  if (apiMode === "mock") return mockRequest<T>(operation, input, key);
  if (!options.path) throw new ApiError("UNAVAILABLE", "실제 API 연결을 준비하고 있어요.", true);
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(options.path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { "idempotency-key": key }),
      },
      ...(options.body === undefined
        ? {}
        : { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError("UNAVAILABLE", "연결하지 못했어요. 다시 시도해 주세요.", true);
  }
  if (!response.ok) {
    const codes = {
      401: "UNAUTHENTICATED",
      403: "CONSENT_REQUIRED",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "QUOTA_EXCEEDED",
    } as const;
    const code =
      codes[response.status as keyof typeof codes] ??
      (response.status >= 500 ? "UNAVAILABLE" : "VALIDATION_ERROR");
    throw new ApiError(
      code,
      code === "UNAUTHENTICATED"
        ? "로그인이 필요해요."
        : code === "CONFLICT"
          ? "내용이 변경됐어요. 다시 불러온 뒤 저장해 주세요."
          : "요청을 완료하지 못했어요. 다시 시도해 주세요.",
      response.status >= 500,
    );
  }
  return (await response.json()) as T;
}
