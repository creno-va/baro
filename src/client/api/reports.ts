import {
  createReportsClient as createSharedReportsClient,
  type DomainRequestInit as SharedRequestInit,
} from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { browserSessionScope } from "./context";

export type { ReportSave } from "@baro/api-client";
export { reportSaveSchema } from "@baro/api-client";
export type DomainRequestInit = SharedRequestInit & { responseType?: "blob" };
export type DomainRequest = <T>(path: string, init?: DomainRequestInit) => Promise<T>;

export function createReportsClient(request: DomainRequest) {
  return createSessionBoundClient(browserSessionScope, () =>
    createSharedReportsClient<Blob>({
      request,
      scope: browserSessionScope,
      newKey: () => crypto.randomUUID(),
      download: async (path, options) => {
        const result = await request<Blob>(path, { ...options, responseType: "blob" });
        if (!(result instanceof Blob))
          throw new Error("다운로드 파일을 확인하지 못했어요. 다시 시도해 주세요.");
        return {
          value: result,
          mimeType: result.type,
          size: result.size,
          read: async (start, end) => new Uint8Array(await result.slice(start, end).arrayBuffer()),
          text: () => result.text(),
          discard: () => {},
        };
      },
    }),
  );
}

/** Browser Response/Blob boundary; common clients receive JSON and artifact ports. */
export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;
export function domainRequest(request: ApiRequest): DomainRequest {
  return async <T>(path: string, init: DomainRequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await request(path, {
      method: init.method ?? "GET",
      headers,
      cache: "no-store",
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; code?: string; retryable?: boolean };
        message?: string;
        code?: string;
      } | null;
      const error = body?.error ?? body;
      const message =
        error?.message ??
        (response.status === 401
          ? "로그인이 필요해요."
          : "요청을 처리하지 못했어요. 다시 확인해 주세요.");
      throw Object.assign(new Error(message), { code: error?.code ?? "UNAVAILABLE" });
    }
    if (init.responseType === "blob") return (await response.blob()) as T;
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };
}
export function createReportsApi(request: ApiRequest) {
  return createReportsClient(domainRequest(request));
}
