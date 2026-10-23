import { ApiError } from "@baro/api-client";
import { z } from "zod";

export interface NativeDiskRequest {
  url: string;
  origin: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  maximum: number;
}
export interface NativeDiskUploadRequest
  extends Omit<NativeDiskRequest, "method" | "body" | "maximum"> {
  method: "PUT";
  maximum: 65536;
  body?: never;
  sourceName: string;
  byteLength: number;
  contentHash: string;
}
type TransferRequest = NativeDiskRequest | NativeDiskUploadRequest;
const resultSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string().max(32768)),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string(),
  fileId: z.string(),
  body: z.string().max(65536),
  maxCopyBytes: z.number().int().min(0).max(65536),
});
export type NativeDiskResult = z.infer<typeof resultSchema>;
export interface NativeDiskPort {
  reserve(): string;
  download(id: string, request: NativeDiskRequest): Promise<unknown>;
  upload?(id: string, request: NativeDiskUploadRequest): Promise<unknown>;
  cancel(id: string): void;
  release(id: string): Promise<void>;
  clear(): Promise<void>;
}
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "기기에 파일을 저장하지 못했어요. 저장 공간과 접근 권한을 확인하고 다시 시도해 주세요.",
    true,
  );

/** Lease native-only bytes until a fenced consumer moves/verifies the opaque fileId. Never returns a URI. */
export function createNativeDiskJobs(native: NativeDiskPort) {
  let epoch = new AbortController(),
    clearing: Promise<void> | undefined;
  const active = new Set<{ done: Promise<unknown> }>(),
    retained = new Set<string>();
  let cleaning: Promise<void> = Promise.resolve();
  const cleanup = () => {
    const next = cleaning
      .catch(() => {})
      .then(async () => {
        for (const id of retained) {
          await native.release(id);
          retained.delete(id);
        }
      });
    cleaning = next;
    return next;
  };
  async function run<T>(
    input: TransferRequest,
    signal: AbortSignal,
    consume: (
      value: NativeDiskResult,
      context: { signal: AbortSignal; ensure(): void },
    ) => Promise<T>,
  ): Promise<T> {
    try {
      const request = { ...input, headers: { ...input.headers } };
      if (request.method === "PUT" && typeof native.upload !== "function")
        throw new ApiError(
          "UNAVAILABLE",
          "파일 업로드 기능을 사용하려면 최신 개발 앱을 설치해 주세요.",
          true,
        );
      if (clearing) await clearing;
      const combined = AbortSignal.any([signal, epoch.signal]);
      combined.throwIfAborted();
      await cleanup();
      combined.throwIfAborted();
      const url = new URL(request.url);
      if (
        url.origin !== request.origin ||
        !url.pathname.startsWith("/api/") ||
        url.username ||
        url.password ||
        url.hash ||
        !["GET", "POST", "PUT"].includes(request.method) ||
        !Number.isSafeInteger(request.maximum) ||
        request.maximum <= 0 ||
        (request.body !== undefined &&
          (request.method !== "POST" || new TextEncoder().encode(request.body).length > 65536))
      )
        throw failed();
      if (
        request.method === "PUT" &&
        (request.maximum !== 65536 ||
          url.search !== "" ||
          !/^\/api\/v2\/me\/lawyer\/assets\/[A-Za-z0-9_-]{1,128}\/content$/.test(url.pathname) ||
          !z.uuid().safeParse(request.sourceName).success ||
          request.sourceName.toLowerCase() !== request.sourceName ||
          !Number.isSafeInteger(request.byteLength) ||
          request.byteLength <= 0 ||
          request.byteLength > 100_000_000 ||
          !/^[a-f0-9]{64}$/.test(request.contentHash))
      )
        throw failed();
      combined.throwIfAborted();
      const id = native.reserve();
      if (!z.uuid().safeParse(id).success) throw failed();
      const cancel = () => {
        try {
          native.cancel(id);
        } catch {}
      };
      combined.addEventListener("abort", cancel, { once: true });
      const ensure = () => {
        combined.throwIfAborted();
      };
      const done = Promise.resolve().then(async () => {
        try {
          ensure();
          const parsed = resultSchema.safeParse(
            request.method === "PUT"
              ? await native.upload?.(id, request)
              : await native.download(id, request),
          );
          ensure();
          if (!parsed.success) throw failed();
          const value = parsed.data,
            ok = value.status >= 200 && value.status < 300;
          if (
            (value.status >= 300 && value.status < 400) ||
            new TextEncoder().encode(value.body).length > 65536 ||
            (ok
              ? value.fileId !== id ||
                value.size <= 0 ||
                value.size > request.maximum ||
                !/^[a-f0-9]{64}$/.test(value.sha256) ||
                value.body !== "" ||
                !value.maxCopyBytes
              : value.fileId !== "" || value.size !== 0 || value.sha256 !== "")
          )
            throw failed();
          const result = await consume(value, { signal: combined, ensure });
          ensure();
          return result;
        } finally {
          combined.removeEventListener("abort", cancel);
          try {
            await native.release(id);
          } catch {
            retained.add(id);
          }
        }
      });
      const transfer = { done };
      active.add(transfer);
      try {
        return await done;
      } finally {
        active.delete(transfer);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw failed();
    }
  }
  return {
    run: <T>(
      input: NativeDiskRequest,
      signal: AbortSignal,
      consume: (
        value: NativeDiskResult,
        context: { signal: AbortSignal; ensure(): void },
      ) => Promise<T>,
    ) => run(input, signal, consume),
    runUpload: <T>(
      input: NativeDiskUploadRequest,
      signal: AbortSignal,
      consume: (
        value: NativeDiskResult,
        context: { signal: AbortSignal; ensure(): void },
      ) => Promise<T>,
    ) => run(input, signal, consume),
    get supportsUpload() {
      return typeof native.upload === "function";
    },
    clear(): Promise<void> {
      if (clearing) return clearing;
      epoch.abort();
      epoch = new AbortController();
      const previous = [...active];
      const done = (async () => {
        try {
          await Promise.allSettled(previous.map((item) => item.done));
          await cleanup();
          await native.clear();
        } catch {
          throw failed();
        }
      })();
      clearing = done.finally(() => {
        clearing = undefined;
      });
      return clearing;
    },
  };
}
