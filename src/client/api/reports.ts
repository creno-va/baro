import { z } from "zod";
import type { ReportView } from "./types";

export type DomainRequestInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: "blob";
};
export type DomainRequest = <T>(path: string, init?: DomainRequestInit) => Promise<T>;
const reportSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string(),
  content: z.string().max(30000),
  updatedAt: z.iso.datetime(),
  stale: z.boolean(),
  excludedFileIds: z.array(z.string()),
  maskIdentifiers: z.boolean(),
});
export const reportSaveSchema = z.object({
  content: z.string().trim().min(1, "내용을 입력해 주세요.").max(30000),
  maskIdentifiers: z.boolean(),
  excludedFileIds: z
    .array(z.string())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ReportSave = z.infer<typeof reportSaveSchema>;
export function createReportsClient(request: DomainRequest) {
  const revisions = new Map<string, number>();
  const pending = new Map<string, { fingerprint: string; key: string }>();
  const accept = (value: unknown): ReportView => {
    const report = reportSchema.parse(value);
    revisions.set(report.caseId, report.revision);
    return report;
  };
  const path = (id: string) => `/api/v2/cases/${encodeURIComponent(id)}/reports`;
  async function write(id: string, method: "PATCH" | "POST", body: unknown) {
    const identity = `${method}:${id}`,
      fingerprint = JSON.stringify(body);
    let previous = pending.get(identity);
    if (!previous || previous.fingerprint !== fingerprint) {
      previous = { fingerprint, key: crypto.randomUUID() };
      pending.set(identity, previous);
    }
    // Retain the key after a lost response. A retry must replay the same version,
    // while changed edits/source revision identify a new operation.
    const report = accept(
      await request<unknown>(path(id), {
        method,
        body,
        headers: { "idempotency-key": previous.key },
      }),
    );
    pending.delete(identity);
    return report;
  }
  async function binary(url: string, type: string, body?: unknown, key?: string) {
    const result = await request<Blob>(url, {
      ...(body
        ? { method: "POST", body, headers: { "idempotency-key": key ?? crypto.randomUUID() } }
        : {}),
      responseType: "blob",
    });
    if (!(result instanceof Blob) || result.type.split(";")[0] !== type || !result.size)
      throw new Error("다운로드 파일을 확인하지 못했어요. 다시 시도해 주세요.");
    const signature = new Uint8Array(await result.slice(0, 5).arrayBuffer());
    if (
      type === "application/pdf"
        ? String.fromCharCode(...signature) !== "%PDF-"
        : signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4
    )
      throw new Error("다운로드 형식이 올바르지 않아요.");
    return result;
  }
  return {
    async get(id: string) {
      return accept(await request<unknown>(path(id)));
    },
    async save(id: string, input: ReportSave) {
      return write(id, "PATCH", {
        ...reportSaveSchema.parse(input),
        expectedRevision: revisions.get(id),
      });
    },
    async generate(id: string) {
      return write(id, "POST", { expectedRevision: revisions.get(id) });
    },
    async pdf(id: string) {
      return binary(`/api/v2/reports/${encodeURIComponent(id)}/pdf`, "application/pdf");
    },
    async zip(id: string, selectedFileIds: string[]) {
      const ids = z
        .array(z.string().min(1))
        .min(1, "원본을 선택해 주세요.")
        .max(100)
        .refine((values) => new Set(values).size === values.length)
        .parse(selectedFileIds);
      const body = { selectedFileIds: ids },
        identity = `ZIP:${id}`,
        fingerprint = JSON.stringify(body);
      let operation = pending.get(identity);
      if (!operation || operation.fingerprint !== fingerprint) {
        operation = { fingerprint, key: crypto.randomUUID() };
        pending.set(identity, operation);
      }
      // Repeated downloads and retries after a lost response reuse the same
      // immutable package. Changed selections create a separate operation.
      return binary(
        `/api/v2/reports/${encodeURIComponent(id)}/zip`,
        "application/zip",
        body,
        operation.key,
      );
    },
  };
}

/** Native fetch boundary shared with the workspace/files domain factories. */
export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;
export function domainRequest(request: ApiRequest): DomainRequest {
  return async <T>(path: string, init: DomainRequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await request(path, {
      method: init.method ?? "GET",
      headers,
      cache: "no-store",
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
