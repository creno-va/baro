import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { V2_LIMITS } from "@baro/contracts/v2";
import {
  createNativeUploadReader,
  NATIVE_READ_BYTES,
  type NativeReadHandle,
} from "../apps/mobile/src/platform/files/upload-reader";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(size = V2_LIMITS.chunkBytes + 17) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 17 + 9) % 251);
  const controller = new AbortController();
  let opened = 0,
    closed = 0,
    maxRead = 0,
    truncate = false,
    oversized = false;
  let afterRead = () => {};
  const snapshot = {
    size,
    open: (): NativeReadHandle => {
      opened++;
      let offset = 0;
      return {
        get size() {
          return bytes.byteLength;
        },
        get offset() {
          return offset;
        },
        set offset(value) {
          offset = value ?? 0;
        },
        async readBytes(count) {
          maxRead = Math.max(maxRead, count);
          const result = bytes.slice(
            offset,
            offset + (truncate ? 0 : oversized ? count + 1 : Math.min(count, 70001)),
          );
          offset += result.byteLength;
          afterRead();
          return result;
        },
        close() {
          closed++;
        },
      };
    },
  };
  return {
    bytes,
    controller,
    snapshot,
    reader: createNativeUploadReader(snapshot, controller.signal),
    stats: () => ({ opened, closed, maxRead }),
    truncate() {
      truncate = true;
    },
    oversize() {
      oversized = true;
    },
    afterRead(callback: () => void) {
      afterRead = callback;
    },
  };
}
test("incremental fingerprint and wire part hashes match independent SHA256 at the chunk boundary with short native reads", async () => {
  const f = fixture();
  expect(await f.reader.fingerprint()).toBe(digest(f.bytes));
  const parts: Uint8Array[] = [];
  for (let start = 0; start < f.bytes.length; start += V2_LIMITS.chunkBytes) {
    const end = Math.min(start + V2_LIMITS.chunkBytes, f.bytes.length),
      part = await f.reader.part(start, end);
    expect(part.byteLength).toBe(end - start);
    expect(part.contentHash).toBe(digest(f.bytes.subarray(start, end)));
    parts.push(new Uint8Array(part.body as ArrayBuffer));
  }
  expect(digest(Buffer.concat(parts))).toBe(digest(f.bytes));
  expect(f.stats().maxRead).toBeLessThanOrEqual(NATIVE_READ_BYTES);
  expect(f.stats().opened).toBe(f.stats().closed);
  await f.reader.close();
  await expect(f.reader.fingerprint()).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
test("same-length byte mutation after fingerprint is rejected before an upload body can be returned", async () => {
  const f = fixture(31);
  await f.reader.fingerprint();
  f.bytes[12] = 255;
  await expect(f.reader.part(0, 31)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats().opened).toBe(f.stats().closed);
});
test("truncation, oversized native reads and changed physical size fail closed with handles released", async () => {
  for (const failure of ["truncate", "oversize", "size"] as const) {
    const f = fixture(NATIVE_READ_BYTES + 1);
    if (failure === "size") f.snapshot.size++;
    else if (failure === "truncate") f.truncate();
    else f.oversize();
    await expect(f.reader.fingerprint()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.stats().opened).toBe(f.stats().closed);
  }
});
test("abort after an awaited native read publishes no body/hash and closes the native descriptor", async () => {
  const f = fixture();
  f.afterRead(() => f.controller.abort());
  await expect(f.reader.fingerprint()).rejects.toBeDefined();
  expect(f.stats().opened).toBe(f.stats().closed);
  expect(f.stats().maxRead).toBe(NATIVE_READ_BYTES);
});
test("close during hashing retires queued parts and closes the descriptor before resolving", async () => {
  const f = fixture();
  let closing: Promise<void> | undefined;
  f.afterRead(() => {
    closing ??= Promise.resolve(f.reader.close());
  });
  const hashing = f.reader.fingerprint(),
    part = f.reader.part(0, V2_LIMITS.chunkBytes);
  await expect(hashing).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(part).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await closing;
  expect(f.stats().opened).toBe(f.stats().closed);
});
test("parallel requests serialize handle reads and noncanonical/out-of-range wire parts never allocate", async () => {
  const f = fixture(37);
  const values = await Promise.all([
    f.reader.fingerprint(),
    f.reader.part(0, 37),
    f.reader.part(0, 37),
  ]);
  expect(values[0]).toBe(digest(f.bytes));
  expect(f.stats().opened).toBe(f.stats().closed);
  const previous = f.stats().opened;
  for (const [start, end] of [
    [1, 37],
    [0, 36],
    [0, NaN],
    [-1, 37],
    [V2_LIMITS.chunkBytes, 37],
  ])
    await expect(f.reader.part(start as number, end as number)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  expect(f.stats().opened).toBe(previous);
});
