import { ApiError, type ReportArtifact } from "@baro/api-client";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { NATIVE_READ_BYTES, type NativeReadHandle } from "./upload-reader";

export interface PrivateDownload {
  readonly size: number;
  readonly mimeType: string;
  readonly sha256: string;
}
export interface DownloadDiskFile {
  size(): number;
  write(bytes: Uint8Array): Promise<void>;
  finish(): void;
  /** Separate native streaming readback; only the digest crosses JS. */
  fingerprint?(): Promise<string>;
  open(): NativeReadHandle;
  text(): Promise<string>;
  remove(): void;
  present(
    mode: "open" | "share",
    input: { name: string; mimeType: string },
    ensureCurrent: () => void,
  ): Promise<void>;
}
const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "파일을 저장하거나 열지 못했어요. 저장 공간과 접근 권한을 확인하고 다시 시도해 주세요.",
    true,
  );
/** Stream to private disk. The caller must fence credentials and retire handles on owner/route changes. */
export function createPrivateDownloads(disk: {
  initialize(): void;
  cleanup?(): void;
  create(mimeType: string, disposition: string): DownloadDiskFile;
  adopt?(fileId: string, mimeType: string, disposition: string): Promise<DownloadDiskFile>;
}) {
  const files = new Map<PrivateDownload, DownloadDiskFile>(),
    cleanup = new Set<DownloadDiskFile>();
  const transfers = new Set<{ abort: AbortController; done: Promise<unknown> }>();
  const retireHooks = new Map<PrivateDownload, () => void>();
  const activities = new Map<DownloadDiskFile, Set<Promise<unknown>>>();
  let initialized = false,
    generation = 0;
  const initialize = () => {
    if (!initialized) {
      disk.initialize();
      initialized = true;
    }
  };
  const clean = () => {
    for (const file of cleanup) {
      if (activities.get(file)?.size) continue;
      file.remove();
      cleanup.delete(file);
    }
    disk.cleanup?.();
  };
  const safe = async <T>(task: () => Promise<T>) => {
    try {
      return await task();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw failed();
    }
  };
  const discard = async (value: PrivateDownload) => {
    retireHooks.get(value)?.();
    retireHooks.delete(value);
    const file = files.get(value);
    files.delete(value);
    if (file) cleanup.add(file);
    if (file) await Promise.allSettled([...(activities.get(file) ?? [])]);
    clean();
  };
  const activity = <T>(
    value: PrivateDownload,
    task: (file: DownloadDiskFile) => Promise<T>,
  ): Promise<T> => {
    const file = files.get(value);
    if (!file) return Promise.reject(failed());
    const pending = safe(() => task(file));
    const set = activities.get(file) ?? new Set();
    activities.set(file, set);
    set.add(pending);
    return pending.finally(() => {
      set.delete(pending);
      if (!set.size) activities.delete(file);
    });
  };
  function publishArtifact(
    file: DownloadDiskFile,
    size: number,
    mimeType: string,
    digest: string,
    combined: AbortSignal,
  ): ReportArtifact<PrivateDownload> {
    const value: PrivateDownload = Object.freeze({
      size,
      mimeType,
      sha256: digest,
    });
    files.set(value, file);
    const retire = () => {
      void discard(value).catch(() => {});
    };
    combined.addEventListener("abort", retire, { once: true });
    retireHooks.set(value, () => combined.removeEventListener("abort", retire));
    const owned = () => {
      const current = files.get(value);
      if (!current || current.size() !== size) throw failed();
      return current;
    };
    return {
      value,
      size,
      mimeType,
      read: (start: number, end: number) =>
        activity(value, async () => {
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start ||
            end > size ||
            end - start > NATIVE_READ_BYTES
          )
            throw failed();
          const handle = owned().open();
          try {
            if (handle.size !== size) throw failed();
            handle.offset = start;
            const bytes = await handle.readBytes(end - start);
            owned();
            if (bytes.byteLength !== end - start || handle.size !== size) throw failed();
            return bytes;
          } finally {
            handle.close();
          }
        }),
      text: () =>
        activity(value, async () => {
          if (size > 30_000_000) throw failed();
          const text = await owned().text();
          owned();
          return text;
        }),
      discard: () => safe(() => discard(value)),
    };
  }
  async function fingerprint(file: DownloadDiskFile, size: number, ensure: () => void) {
    ensure();
    if (file.size() !== size) throw failed();
    if (file.fingerprint) {
      const digest = await file.fingerprint();
      ensure();
      if (file.size() !== size || !/^[a-f0-9]{64}$/.test(digest)) throw failed();
      return digest;
    }
    const handle = file.open(),
      hash = sha256.create();
    try {
      if (handle.size !== size) throw failed();
      for (let start = 0; start < size; ) {
        ensure();
        handle.offset = start;
        const count = Math.min(NATIVE_READ_BYTES, size - start),
          bytes = await handle.readBytes(count);
        ensure();
        if (
          !bytes.byteLength ||
          bytes.byteLength > count ||
          handle.offset !== start + bytes.byteLength
        )
          throw failed();
        hash.update(bytes);
        start += bytes.byteLength;
      }
      if (handle.size !== size || file.size() !== size) throw failed();
      return bytesToHex(hash.digest());
    } finally {
      handle.close();
      hash.destroy();
    }
  }
  return {
    async adopt(
      input: {
        fileId: string;
        size: number;
        sha256: string;
        mimeType: string;
        disposition: string;
      },
      signal: AbortSignal,
      maximum: number,
    ): Promise<ReportArtifact<PrivateDownload>> {
      input = { ...input };
      const captured = generation,
        abort = new AbortController(),
        combined = AbortSignal.any([signal, abort.signal]);
      const ensure = () => {
        combined.throwIfAborted();
        if (captured !== generation) throw failed();
      };
      const task = Promise.resolve().then(() =>
        safe(async () => {
          let file: DownloadDiskFile | undefined,
            accepted = false;
          try {
            ensure();
            if (
              !disk.adopt ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                input.fileId,
              ) ||
              !Number.isSafeInteger(maximum) ||
              maximum <= 0 ||
              !Number.isSafeInteger(input.size) ||
              input.size <= 0 ||
              input.size > maximum ||
              !/^[a-f0-9]{64}$/.test(input.sha256) ||
              !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(input.mimeType)
            )
              throw failed();
            initialize();
            clean();
            file = await disk.adopt(input.fileId, input.mimeType, input.disposition);
            ensure();
            file.finish();
            if ((await fingerprint(file, input.size, ensure)) !== input.sha256) throw failed();
            ensure();
            const artifact = publishArtifact(
              file,
              input.size,
              input.mimeType,
              input.sha256,
              combined,
            );
            accepted = true;
            return artifact;
          } finally {
            if (file && !accepted) {
              try {
                file.finish();
              } catch {}
              cleanup.add(file);
              try {
                clean();
              } catch {
                /* Keep failed cleanup for the next explicit reset. */
              }
            }
          }
        }),
      );
      const transfer = { abort, done: task };
      transfers.add(transfer);
      let artifact: ReportArtifact<PrivateDownload> | undefined;
      try {
        artifact = await task;
        ensure();
        return artifact;
      } catch {
        if (artifact) {
          try {
            await discard(artifact.value);
          } catch {}
        }
        throw failed();
      } finally {
        transfers.delete(transfer);
      }
    },
    async receive(
      response: Response,
      signal: AbortSignal,
      maximum: number,
    ): Promise<ReportArtifact<PrivateDownload>> {
      const captured = generation,
        abort = new AbortController(),
        combined = AbortSignal.any([signal, abort.signal]);
      const ensure = () => {
        combined.throwIfAborted();
        if (captured !== generation) throw failed();
      };
      const task = safe(async () => {
        let file: DownloadDiskFile | undefined,
          accepted = false;
        const reader = response.body?.getReader();
        const cancel = () => {
          void reader?.cancel().catch(() => {});
        };
        combined.addEventListener("abort", cancel, { once: true });
        const hash = sha256.create();
        try {
          ensure();
          initialize();
          clean();
          const mimeType =
            (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
          const length = response.headers.get("content-length"),
            encoding = response.headers.get("content-encoding")?.trim().toLowerCase(),
            // Native fetch decodes transport compression. Its wire Content-Length
            // then describes compressed bytes, not the bytes written to disk.
            expected =
              length === null || (encoding && encoding !== "identity") ? undefined : Number(length);
          if (
            !response.ok ||
            !reader ||
            !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType) ||
            !Number.isSafeInteger(maximum) ||
            maximum <= 0 ||
            (expected !== undefined &&
              (!/^[1-9]\d*$/.test(length ?? "") ||
                !Number.isSafeInteger(expected) ||
                expected > maximum))
          )
            throw failed();
          file = disk.create(mimeType, response.headers.get("content-disposition") ?? "");
          let size = 0;
          for (;;) {
            const chunk = await reader.read();
            ensure();
            if (chunk.done) break;
            if (
              !(chunk.value instanceof Uint8Array) ||
              chunk.value.byteLength === 0 ||
              size + chunk.value.byteLength > maximum ||
              (expected !== undefined && size + chunk.value.byteLength > expected)
            )
              throw failed();
            hash.update(chunk.value);
            for (let offset = 0; offset < chunk.value.byteLength; offset += NATIVE_READ_BYTES) {
              await file.write(chunk.value.subarray(offset, offset + NATIVE_READ_BYTES));
              ensure();
            }
            size += chunk.value.byteLength;
          }
          if (!size || (expected !== undefined && size !== expected)) throw failed();
          file.finish();
          ensure();
          if (file.size() !== size) throw failed();
          const digest = bytesToHex(hash.digest());
          if ((await fingerprint(file, size, ensure)) !== digest) throw failed();
          ensure();
          const artifact = publishArtifact(file, size, mimeType, digest, combined);
          accepted = true;
          return artifact;
        } finally {
          combined.removeEventListener("abort", cancel);
          hash.destroy();
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
          if (file && !accepted) {
            try {
              file.finish();
            } catch {}
            cleanup.add(file);
            try {
              clean();
            } catch {
              /* Retain failed cleanup. */
            }
          }
        }
      });
      const transfer = { abort, done: task };
      transfers.add(transfer);
      let artifact: ReportArtifact<PrivateDownload> | undefined;
      try {
        artifact = await task;
        ensure();
        return artifact;
      } catch {
        if (artifact) {
          try {
            await discard(artifact.value);
          } catch {}
        }
        throw failed();
      } finally {
        transfers.delete(transfer);
      }
    },
    present(
      value: PrivateDownload,
      mode: "open" | "share",
      input: { name: string; mimeType: string },
      ensureCurrent: () => void,
    ) {
      return activity(value, async () => {
        ensureCurrent();
        const file = files.get(value);
        if (!file || file.size() !== value.size) throw failed();
        const check = () => {
          ensureCurrent();
          if (files.get(value) !== file || file.size() !== value.size) throw failed();
        };
        await file.present(mode, input, () => {
          check();
          // Native preview/share can background the app. Once the user actually
          // hands off, owner/route cleanup replaces transfer-signal retirement.
          retireHooks.get(value)?.();
          retireHooks.delete(value);
        });
        ensureCurrent();
        if (!files.has(value)) throw failed();
      });
    },
    discard: (value: PrivateDownload) => safe(() => discard(value)),
    clear: () =>
      safe(async () => {
        generation++;
        initialize();
        for (const file of files.values()) cleanup.add(file);
        for (const remove of retireHooks.values()) remove();
        retireHooks.clear();
        files.clear();
        const active = [...transfers];
        for (const item of active) item.abort.abort();
        await Promise.allSettled(active.map((item) => item.done));
        await Promise.allSettled([...activities.values()].flatMap((set) => [...set]));
        clean();
      }),
  };
}
