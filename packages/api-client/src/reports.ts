import type { ReportView, SessionScope } from "@baro/client-core";
import { z } from "zod";
import { ApiError } from "./errors";
import { createWorkspaceRecovery, type WorkspaceRecovery } from "./workspace-recovery";

export type ReportRecovery = WorkspaceRecovery;

export interface DomainRequestInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}
export type DomainRequest = <T>(path: string, options?: DomainRequestInit) => Promise<T>;
/** Platform-owned file handle. No browser Blob or native URI behavior is assumed. */
export interface ReportArtifact<T> {
  value: T;
  mimeType: string;
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
  text(): Promise<string>;
  discard(): Promise<void> | void;
}

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
  includedPhotoIds: z.array(z.string()).max(12).optional(),
  photoCandidates: z
    .array(z.object({ id: z.string(), name: z.string(), revision: z.number().int().positive() }))
    .max(100)
    .optional(),
  basis: z
    .object({
      workspaceRevision: z.number().int().positive(),
      summaryRevision: z.number().int().positive(),
      generatedAt: z.iso.datetime(),
    })
    .optional(),
  pdfAvailable: z.boolean().optional(),
  savedZip: z
    .object({
      id: z.string().min(1),
      fileCount: z.number().int().min(1).max(100),
      createdAt: z.iso.datetime(),
    })
    .optional(),
});
export const reportSaveSchema = z.object({
  content: z.string().trim().min(1, "내용을 입력해 주세요.").max(30000),
  maskIdentifiers: z.boolean(),
  includedPhotoIds: z
    .array(z.string())
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  excludedFileIds: z
    .array(z.string())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ReportSave = z.infer<typeof reportSaveSchema>;
export function createReportsClient<Download>(dependencies: {
  request: DomainRequest;
  download: (
    path: string,
    options: DomainRequestInit & { signal: AbortSignal },
  ) => Promise<ReportArtifact<Download>>;
  scope: SessionScope;
  /** Only opt in when the adapter controls credential changes through this scope. */
  coalesceWrites?: "credential-scope";
  signal?: AbortSignal;
  newKey: () => string;
  /** Native opt-in: durable opaque keys; mutations must supply the displayed revision. */
  recovery?: ReportRecovery;
}) {
  const generation = dependencies.scope.snapshot();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
    : dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const request: DomainRequest = async <T>(path: string, options: DomainRequestInit = {}) => {
    ensureCurrent();
    try {
      const value = await dependencies.request<T>(path, {
        ...options,
        signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
      });
      ensureCurrent();
      return value;
    } catch (error) {
      ensureCurrent();
      throw error;
    }
  };
  const recovery = dependencies.recovery
    ? createWorkspaceRecovery({
        recovery: dependencies.recovery,
        scope: dependencies.scope,
        ensureCurrent,
        newKey: dependencies.newKey,
        namespace: "reports",
      })
    : undefined;
  const revisions = new Map<string, number>();
  const generations = new Map<string, { selection: string; revision: number | undefined }>();
  const saves = new Map<string, { revision: number | undefined }>();
  const pending = new Map<string, { fingerprint: string; key: string }>();
  const accept = (value: unknown, caseId: string): ReportView => {
    const report = reportSchema.parse(value);
    if (report.caseId !== caseId)
      throw new ApiError("UNAVAILABLE", "리포트를 다시 확인해 주세요.", true);
    revisions.set(report.caseId, report.revision);
    return report;
  };
  const path = (id: string) => `/api/v2/cases/${encodeURIComponent(id)}/reports`;
  async function write(id: string, method: "PATCH" | "POST", body: unknown) {
    if (
      recovery &&
      !z.object({ expectedRevision: z.number().int().positive() }).safeParse(body).success
    )
      throw new ApiError("VALIDATION_ERROR", "화면에서 확인한 리포트 버전을 다시 확인해 주세요.");
    const fingerprint = JSON.stringify(body),
      identity = `${method}:${id}:${fingerprint}`;
    let previous = pending.get(identity);
    if (!previous || previous.fingerprint !== fingerprint) {
      previous = { fingerprint, key: dependencies.newKey() };
      pending.set(identity, previous);
    }
    // Retain the key after a lost response. A retry must replay the same version,
    // while changed edits/source revision identify a new operation.
    const prepared = recovery ? await recovery.prepare(path(id), body, method) : undefined;
    const report = accept(
      await request<unknown>(path(id), {
        method,
        body,
        headers: prepared
          ? Object.fromEntries(new Headers(prepared.headers).entries())
          : { "idempotency-key": previous.key },
      }),
      id,
    );
    if (prepared) await recovery?.complete(prepared);
    pending.delete(identity);
    return report;
  }
  async function artifact(
    url: string,
    type: string,
    body?: unknown,
    key?: string,
    headers?: Record<string, string>,
  ): Promise<Download> {
    ensureCurrent();
    const result = await dependencies.download(url, {
      ...(body
        ? {
            method: "POST",
            body,
            headers: { ...headers, "idempotency-key": key ?? dependencies.newKey() },
          }
        : {}),
      signal,
    });
    let accepted = false;
    try {
      ensureCurrent();
      if (
        result.mimeType.split(";")[0] !== type ||
        !Number.isSafeInteger(result.size) ||
        result.size <= 0
      )
        throw new Error("다운로드 파일을 확인하지 못했어요. 다시 시도해 주세요.");
      if (type === "text/html") {
        if (result.size > 30_000_000)
          throw new Error("HTML 리포트를 확인하지 못했어요. 다시 시도해 주세요.");
        const text = await result.text();
        ensureCurrent();
        if (!text.startsWith("<!doctype html>") || !text.includes('data-baro-report="1"'))
          throw new Error("HTML 리포트 형식이 올바르지 않아요.");
      } else {
        const signature = await result.read(0, 5);
        ensureCurrent();
        if (
          signature.byteLength > 5 ||
          (type === "application/pdf"
            ? String.fromCharCode(...signature) !== "%PDF-"
            : signature[0] !== 0x50 ||
              signature[1] !== 0x4b ||
              signature[2] !== 3 ||
              signature[3] !== 4)
        )
          throw new Error("다운로드 형식이 올바르지 않아요.");
      }
      accepted = true;
      return result.value;
    } finally {
      if (!accepted) {
        try {
          await result.discard();
        } catch {
          /* Adapter owns retryable orphan cleanup. */
        }
      }
    }
  }
  const client = {
    async get(id: string) {
      return accept(await request<unknown>(path(id)), id);
    },
    async save(id: string, input: ReportSave, expectedRevision?: number) {
      if (recovery && expectedRevision === undefined)
        throw new ApiError("VALIDATION_ERROR", "화면에서 확인한 리포트 버전을 다시 확인해 주세요.");
      const normalized = reportSaveSchema.parse(input);
      const identity = `${id}:${JSON.stringify(normalized)}`;
      const previous = saves.get(identity);
      const revision =
        expectedRevision !== undefined
          ? expectedRevision
          : previous
            ? previous.revision
            : revisions.get(id);
      saves.set(identity, { revision });
      try {
        const report = await write(id, "PATCH", { ...normalized, expectedRevision: revision });
        saves.delete(identity);
        return report;
      } catch (cause) {
        if (["STALE_REVISION", "CONFLICT"].includes((cause as { code?: string })?.code ?? ""))
          saves.delete(identity);
        throw cause;
      }
    },
    async generate(id: string, excludedFileIds?: string[], expectedRevision?: number) {
      if (recovery && expectedRevision === undefined)
        throw new ApiError("VALIDATION_ERROR", "화면에서 확인한 리포트 버전을 다시 확인해 주세요.");
      const selection = JSON.stringify({ excludedFileIds }),
        generationIdentity = `${id}:${selection}`,
        previous = generations.get(generationIdentity),
        revision =
          expectedRevision !== undefined
            ? expectedRevision
            : previous?.selection === selection
              ? previous.revision
              : revisions.get(id);
      generations.set(generationIdentity, { selection, revision });
      try {
        const report = await write(id, "POST", {
          expectedRevision: revision,
          ...(excludedFileIds ? { excludedFileIds } : {}),
        });
        generations.delete(generationIdentity);
        return report;
      } catch (cause) {
        // A definite conflict can be retried with a newly loaded version. Keep the
        // original basis for ambiguous failures so a metadata GET cannot fork it.
        if (["STALE_REVISION", "CONFLICT"].includes((cause as { code?: string })?.code ?? ""))
          generations.delete(generationIdentity);
        throw cause;
      }
    },
    async pdf(id: string) {
      return artifact(`/api/v2/reports/${encodeURIComponent(id)}/pdf`, "application/pdf");
    },
    async savedZip(id: string) {
      return artifact(`/api/v2/reports/${encodeURIComponent(id)}/zip`, "application/zip");
    },
    async html(id: string) {
      return artifact(`/api/v2/reports/${encodeURIComponent(id)}/html`, "text/html");
    },
    async zip(id: string, selectedFileIds: string[]) {
      const ids = z
        .array(z.string().min(1))
        .min(1, "원본을 선택해 주세요.")
        .max(100)
        .refine((values) => new Set(values).size === values.length)
        .parse(selectedFileIds);
      const body = { selectedFileIds: ids },
        fingerprint = JSON.stringify(body),
        identity = `ZIP:${id}:${fingerprint}`;
      let operation = pending.get(identity);
      if (!operation || operation.fingerprint !== fingerprint) {
        operation = { fingerprint, key: dependencies.newKey() };
        pending.set(identity, operation);
      }
      // Repeated downloads and retries after a lost response reuse the same
      // immutable package. Changed selections create a separate operation.
      const url = `/api/v2/reports/${encodeURIComponent(id)}/zip`;
      const prepared = recovery ? await recovery.prepare(url, body) : undefined;
      return artifact(
        url,
        "application/zip",
        body,
        prepared
          ? (new Headers(prepared.headers).get("idempotency-key") ?? operation.key)
          : operation.key,
        prepared ? Object.fromEntries(new Headers(prepared.headers).entries()) : undefined,
      );
    },
  };
  const pendingWrites = new Map<string, Promise<unknown>>();
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        ensureCurrent();
        const invoke = async () => {
          try {
            const result = await Reflect.apply(value, target, args);
            ensureCurrent();
            return result;
          } catch (error) {
            ensureCurrent();
            throw error;
          }
        };
        if (
          dependencies.coalesceWrites !== "credential-scope" ||
          (key !== "save" && key !== "generate" && key !== "zip")
        )
          return invoke();
        const identity = JSON.stringify([key, args]);
        const previous = pendingWrites.get(identity);
        if (previous) return previous;
        const task = invoke();
        pendingWrites.set(identity, task);
        try {
          return await task;
        } finally {
          if (pendingWrites.get(identity) === task) pendingWrites.delete(identity);
        }
      };
    },
  });
}
