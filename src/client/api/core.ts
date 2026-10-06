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
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

export async function responseError(response: Response): Promise<ApiError> {
  const statusCodes = {
    401: "UNAUTHENTICATED",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "QUOTA_EXCEEDED",
  } as const;
  const serverCodes = {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    CONSENT_REQUIRED: "CONSENT_REQUIRED",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    REVISION_CONFLICT: "CONFLICT",
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
    RATE_LIMITED: "QUOTA_EXCEEDED",
    TURNSTILE_FAILED: "VALIDATION_ERROR",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    BUDGET_UNAVAILABLE: "UNAVAILABLE",
    UNAVAILABLE: "UNAVAILABLE",
  } as const;
  let raw: string | undefined;
  try {
    const body = (await response.json()) as { error?: { code?: unknown }; code?: unknown };
    const candidate = body.error?.code ?? body.code;
    if (typeof candidate === "string") raw = candidate;
  } catch {
    /* Untrusted or non-JSON errors use a safe status fallback. */
  }
  const code =
    serverCodes[raw as keyof typeof serverCodes] ??
    statusCodes[response.status as keyof typeof statusCodes] ??
    (response.status >= 500 ? "UNAVAILABLE" : "VALIDATION_ERROR");
  const messages = {
    UNAUTHENTICATED: "로그인이 필요해요.",
    CONSENT_REQUIRED: "필수 동의를 확인해 주세요.",
    NOT_FOUND: "요청한 내용을 찾지 못했어요.",
    CONFLICT: "내용이 변경됐어요. 다시 불러온 뒤 저장해 주세요.",
    QUOTA_EXCEEDED: "이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
    VALIDATION_ERROR:
      raw === "TURNSTILE_FAILED"
        ? "보안 확인을 다시 진행해 주세요."
        : "입력한 내용을 확인해 주세요.",
    UNAVAILABLE:
      raw === "BUDGET_UNAVAILABLE"
        ? "AI 처리를 지금 시작할 수 없어요. 저장한 내용은 보존돼요."
        : "요청을 완료하지 못했어요. 다시 시도해 주세요.",
  };
  return new ApiError(code, messages[code], code === "UNAVAILABLE" || code === "QUOTA_EXCEEDED");
}

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

/** Keep domain state across API failures; retry only a failed module/factory load. */
export function cacheClient<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
