import { ApiError, type UploadReader } from "@baro/api-client";
import { V2_LIMITS } from "@baro/contracts/v2";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const NATIVE_READ_BYTES = 256 * 1024;
export interface NativeReadHandle {
  size: number | null;
  offset: number | null;
  readBytes(length: number): Promise<Uint8Array<ArrayBuffer>>;
  close(): void;
}
export interface NativeUploadSnapshot {
  size: number;
  open(): NativeReadHandle;
}
const unavailable = () =>
  new ApiError(
    "UNAVAILABLE",
    "파일을 읽지 못했어요. 저장 공간과 접근 권한을 확인하고 다시 선택해 주세요.",
    true,
  );

/** Fixed-size native reads; no base64 or whole-file buffer. Snapshot bytes never leave this port. */
export function createNativeUploadReader(
  snapshot: NativeUploadSnapshot,
  signal: AbortSignal,
): UploadReader {
  if (
    !Number.isSafeInteger(snapshot.size) ||
    snapshot.size <= 0 ||
    snapshot.size > V2_LIMITS.mediaBytes
  )
    throw unavailable();
  let closed = false,
    pending: Promise<unknown> = Promise.resolve();
  let fingerprint: string | undefined;
  const partHashes = new Map<number, string>();
  const ensure = () => {
    signal.throwIfAborted();
    if (closed) throw unavailable();
  };
  const serial = <T>(action: () => Promise<T>) => {
    const task = pending
      .catch(() => {})
      .then(async () => {
        ensure();
        try {
          return await action();
        } catch {
          ensure();
          throw unavailable();
        }
      });
    pending = task;
    return task;
  };
  async function withHandle<T>(action: (handle: NativeReadHandle) => Promise<T>) {
    ensure();
    const handle = snapshot.open();
    try {
      if (handle.size !== snapshot.size) throw unavailable();
      const value = await action(handle);
      ensure();
      if (handle.size !== snapshot.size) throw unavailable();
      return value;
    } finally {
      handle.close();
    }
  }
  async function read(handle: NativeReadHandle, start: number, size: number) {
    ensure();
    handle.offset = start;
    const result = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      ensure();
      const count = Math.min(size - offset, NATIVE_READ_BYTES);
      const bytes = await handle.readBytes(count);
      ensure();
      if (
        bytes.byteLength <= 0 ||
        bytes.byteLength > count ||
        handle.offset !== start + offset + bytes.byteLength
      )
        throw unavailable();
      result.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return result;
  }
  const hash = async () => {
    if (fingerprint) return fingerprint;
    const complete = sha256.create();
    let part = sha256.create();
    const expected = new Map<number, string>();
    try {
      const digest = await withHandle(async (handle) => {
        for (let start = 0; start < snapshot.size; start += NATIVE_READ_BYTES) {
          const bytes = await read(
            handle,
            start,
            Math.min(NATIVE_READ_BYTES, snapshot.size - start),
          );
          complete.update(bytes);
          part.update(bytes);
          const end = start + bytes.byteLength;
          if (end % V2_LIMITS.chunkBytes === 0 || end === snapshot.size) {
            expected.set(
              Math.floor(start / V2_LIMITS.chunkBytes) * V2_LIMITS.chunkBytes,
              bytesToHex(part.digest()),
            );
            part.destroy();
            part = sha256.create();
          }
        }
        return bytesToHex(complete.digest());
      });
      for (const [start, value] of expected) partHashes.set(start, value);
      fingerprint = digest;
      return digest;
    } finally {
      complete.destroy();
      part.destroy();
    }
  };
  return {
    fingerprint: () => serial(hash),
    part: (start, end) =>
      serial(async () => {
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          start % V2_LIMITS.chunkBytes !== 0 ||
          end !== Math.min(start + V2_LIMITS.chunkBytes, snapshot.size) ||
          end <= start
        )
          throw unavailable();
        await hash();
        const bytes = await withHandle((handle) => read(handle, start, end - start));
        const contentHash = bytesToHex(sha256(bytes));
        if (partHashes.get(start) !== contentHash) throw unavailable();
        return { body: bytes.buffer, byteLength: bytes.byteLength, contentHash };
      }),
    async close() {
      closed = true;
      await pending.catch(() => {});
      partHashes.clear();
      fingerprint = undefined;
    },
  };
}
