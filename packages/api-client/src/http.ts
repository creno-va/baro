import type { SessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { ApiError, responseError } from "./errors";

export type HttpTransport = (path: string, init: RequestInit) => Promise<Response>;
export interface JsonRequestOptions {
  path: string;
  method?: string;
  body?: unknown;
  key?: string;
  expectedOwner?: string;
  signal?: AbortSignal;
}
export type JsonRequest = <T = unknown>(options: JsonRequestOptions) => Promise<T>;
export type OperationRequestOptions = Omit<JsonRequestOptions, "path"> & { path?: string };
export type OperationRequest = <T = unknown>(
  operation: string,
  input?: unknown,
  options?: OperationRequestOptions,
) => Promise<T>;
export interface EncodedBody {
  body: BodyInit;
  contentType?: string;
}

export function isApiPath(path: string): boolean {
  if (!path.startsWith("/api/") || /[\\#\r\n]/.test(path)) return false;
  try {
    const url = new URL(path, "https://api.invalid");
    return url.origin === "https://api.invalid" && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** HTTP and UUID are ports. Cookies, native storage and multipart construction belong to adapters. */
export function createJsonRequester(dependencies: {
  transport: HttpTransport;
  newKey: () => string;
  encodeBody?: (value: unknown) => EncodedBody;
  scope?: SessionScope;
}): JsonRequest {
  return async <T>(options: JsonRequestOptions): Promise<T> => {
    if (!isApiPath(options.path))
      throw new ApiError("VALIDATION_ERROR", "요청 경로를 확인해 주세요.");
    const signal = dependencies.scope
      ? options.signal
        ? AbortSignal.any([options.signal, dependencies.scope.signal()])
        : dependencies.scope.signal()
      : options.signal;
    signal?.throwIfAborted();
    const generation = dependencies.scope?.snapshot();
    const ensureCurrent = () => {
      if (generation !== undefined && !dependencies.scope?.isCurrent(generation))
        throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
      signal?.throwIfAborted();
    };
    const method = options.method ?? "GET";
    let encoded: EncodedBody | undefined;
    try {
      if (options.body !== undefined)
        encoded = dependencies.encodeBody
          ? dependencies.encodeBody(options.body)
          : { body: JSON.stringify(options.body), contentType: "application/json" };
    } catch {
      throw new ApiError("VALIDATION_ERROR", "전송할 내용을 확인해 주세요.");
    }
    const headers: Record<string, string> = {};
    if (options.expectedOwner !== undefined) {
      if (!options.expectedOwner || options.expectedOwner.length > 128)
        throw new ApiError("VALIDATION_ERROR", "이용 계정을 다시 확인해 주세요.");
      headers[EXPECTED_OWNER_HEADER] = encodeURIComponent(options.expectedOwner);
    }
    const contentType = encoded ? encoded.contentType : "application/json";
    if (contentType) headers["content-type"] = contentType;
    if (method !== "GET" && method !== "HEAD")
      headers["idempotency-key"] = options.key ?? dependencies.newKey();
    let response: Response;
    try {
      response = await dependencies.transport(options.path, {
        method,
        headers,
        ...(signal ? { signal } : {}),
        ...(encoded ? { body: encoded.body } : {}),
      });
    } catch (error) {
      ensureCurrent();
      if (error instanceof ApiError) throw error;
      throw new ApiError("UNAVAILABLE", "연결하지 못했어요. 다시 시도해 주세요.", true);
    }
    ensureCurrent();
    if (!response.ok) {
      const error = await responseError(response);
      ensureCurrent();
      throw error;
    }
    if (response.status === 204) return undefined as T;
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      ensureCurrent();
      throw new ApiError("UNAVAILABLE", "서버 응답을 확인하지 못했어요. 다시 시도해 주세요.", true);
    }
    ensureCurrent();
    return result as T;
  };
}
