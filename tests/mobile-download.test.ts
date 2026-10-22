import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createPrivateDownloads,
  type DownloadDiskFile,
} from "../apps/mobile/src/platform/files/download";
import { NATIVE_READ_BYTES } from "../apps/mobile/src/platform/files/upload-reader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function fixture() {
  const disk = new Map<number, Uint8Array>();
  let corrupt = false,
    id = 0,
    ignoreDelete = false,
    wrongSize = false,
    maxWrite = 0,
    closed = 0,
    shown = 0;
  let beforeWrite = async () => {},
    beforeRead = async () => {},
    beforeShow = async () => {};
  const cache = createPrivateDownloads({
    initialize() {},
    create() {
      const key = ++id;
      disk.set(key, new Uint8Array());
      let finished = false;
      const file: DownloadDiskFile = {
        size: () => (disk.get(key)?.byteLength ?? -1) + (wrongSize ? 1 : 0),
        async write(bytes) {
          maxWrite = Math.max(maxWrite, bytes.byteLength);
          await beforeWrite();
          const current = disk.get(key) ?? new Uint8Array(),
            next = new Uint8Array(current.length + bytes.length);
          next.set(current);
          next.set(bytes, current.length);
          if (corrupt) next[0] = 255;
          disk.set(key, next);
        },
        finish() {
          finished = true;
        },
        open() {
          if (!finished) throw new Error("SYNTHETIC_NOT_CLOSED");
          let offset = 0;
          return {
            get size() {
              return disk.get(key)?.byteLength ?? null;
            },
            get offset() {
              return offset;
            },
            set offset(value) {
              offset = value ?? 0;
            },
            async readBytes(count) {
              await beforeRead();
              const value = disk.get(key)?.slice(offset, offset + count) ?? new Uint8Array();
              offset += value.byteLength;
              return value;
            },
            close() {
              closed++;
            },
          };
        },
        async text() {
          return new TextDecoder().decode(disk.get(key));
        },
        remove() {
          if (!ignoreDelete) disk.delete(key);
          if (disk.has(key)) throw new Error("SYNTHETIC_DELETE_FAILED");
        },
        async present(_mode, _input, ensure) {
          await beforeShow();
          ensure();
          shown++;
        },
      };
      return file;
    },
  });
  return {
    cache,
    disk,
    stats: () => ({ maxWrite, closed, shown }),
    deleteFailure: (value: boolean) => {
      ignoreDelete = value;
    },
    wrongSize: () => {
      wrongSize = true;
    },
    corruptWrite: () => {
      corrupt = true;
    },
    beforeWrite: (task: () => Promise<void>) => {
      beforeWrite = task;
    },
    beforeRead: (task: () => Promise<void>) => {
      beforeRead = task;
    },
    beforeShow: (task: () => Promise<void>) => {
      beforeShow = task;
    },
  };
}
const input = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        ...headers,
      },
    },
  );
test("a private download streams exact bytes with bounded disk writes, independent hash and no whole-body reader", async () => {
  const f = fixture(),
    bytes = Uint8Array.from({ length: NATIVE_READ_BYTES * 2 + 13 }, (_, i) => i % 251);
  const response = input(bytes);
  response.arrayBuffer = async () => {
    throw new Error("MUST_NOT_BUFFER_BODY");
  };
  const artifact = await f.cache.receive(response, new AbortController().signal, bytes.byteLength);
  expect(artifact.value.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(f.stats().maxWrite).toBe(NATIVE_READ_BYTES);
  expect([...f.disk.values()][0]).toEqual(bytes);
  expect(await artifact.read(0, 5)).toEqual(bytes.slice(0, 5));
  await artifact.discard();
  expect(f.disk.size).toBe(0);
  await expect(artifact.read(0, 5)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
for (const failure of ["short", "long", "invalid-length", "invalid-type", "disk-size"] as const)
  test(`invalid ${failure} download is never published and partial cache is removed`, async () => {
    const f = fixture();
    if (failure === "disk-size") f.wrongSize();
    const headers: Record<string, string> =
      failure === "invalid-type"
        ? { "content-type": "text/../../unsafe" }
        : {
            "content-length":
              failure === "short"
                ? "4"
                : failure === "long"
                  ? "2"
                  : failure === "invalid-length"
                    ? "NaN"
                    : "3",
          };
    await expect(
      f.cache.receive(input(new Uint8Array([1, 2, 3]), headers), new AbortController().signal, 10),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.disk.size).toBe(0);
  });
test("abort/clear while awaiting a native write cancels the stream and waits for descriptor cleanup", async () => {
  const f = fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  f.beforeWrite(async () => {
    entered.resolve();
    await release.promise;
  });
  const transfer = f.cache
    .receive(input(new Uint8Array([1, 2, 3])), new AbortController().signal, 3)
    .catch((error: unknown) => error);
  await entered.promise;
  const clear = f.cache.clear();
  release.resolve();
  expect(await transfer).toMatchObject({ code: "UNAVAILABLE" });
  await clear;
  expect(f.disk.size).toBe(0);
});
test("decoded transport compression uses decoded byte limits and an explicit handoff survives background signal retirement", async () => {
  const f = fixture(),
    abort = new AbortController();
  const artifact = await f.cache.receive(
    input(new Uint8Array([1, 2, 3]), { "content-length": "2", "content-encoding": "gzip" }),
    abort.signal,
    3,
  );
  expect(artifact.size).toBe(3);
  await f.cache.present(
    artifact.value,
    "share",
    { name: "합성.bin", mimeType: "application/octet-stream" },
    () => {},
  );
  abort.abort();
  expect(await artifact.read(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
  await f.cache.clear();
  expect(f.disk.size).toBe(0);
});
test("retirement during signature IO does not publish bytes and deletion waits for the handle to close", async () => {
  const f = fixture(),
    artifact = await f.cache.receive(
      input(new Uint8Array([1, 2, 3])),
      new AbortController().signal,
      3,
    ),
    entered = deferred<void>(),
    release = deferred<void>();
  f.beforeRead(async () => {
    entered.resolve();
    await release.promise;
  });
  const before = f.stats().closed;
  const read = artifact.read(0, 3).catch((error: unknown) => error);
  await entered.promise;
  const clear = f.cache.clear();
  expect(f.disk.size).toBe(1);
  release.resolve();
  expect(await read).toMatchObject({ code: "UNAVAILABLE" });
  await clear;
  expect(f.stats().closed).toBe(before + 1);
  expect(f.disk.size).toBe(0);
});
test("a same-length silent disk corruption is rejected by independent readback hashing before any handle is published", async () => {
  const f = fixture();
  f.corruptWrite();
  await expect(
    f.cache.receive(input(new Uint8Array([1, 2, 3])), new AbortController().signal, 3),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.disk.size).toBe(0);
  expect(f.stats().closed).toBe(1);
});
test("a late owner change during native share preflight cannot open an external app", async () => {
  const f = fixture(),
    artifact = await f.cache.receive(
      input(new Uint8Array([1, 2, 3])),
      new AbortController().signal,
      3,
    ),
    entered = deferred<void>(),
    release = deferred<void>();
  let owner = "a";
  f.beforeShow(async () => {
    entered.resolve();
    await release.promise;
  });
  const presenting = f.cache
    .present(artifact.value, "share", { name: "합성.pdf", mimeType: "application/pdf" }, () => {
      if (owner !== "a") throw new Error("SYNTHETIC_OWNER_CHANGED");
    })
    .catch((error: unknown) => error);
  await entered.promise;
  owner = "b";
  release.resolve();
  expect(await presenting).toMatchObject({ code: "UNAVAILABLE" });
  expect(f.stats().shown).toBe(0);
  await f.cache.clear();
});
test("failed private cleanup is retained for retry and a settled transfer is retired by its signal", async () => {
  const f = fixture(),
    abort = new AbortController(),
    artifact = await f.cache.receive(input(new Uint8Array([1, 2, 3])), abort.signal, 3);
  f.deleteFailure(true);
  await expect(artifact.discard()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.deleteFailure(false);
  await f.cache.clear();
  expect(f.disk.size).toBe(0);
  const next = await f.cache.receive(input(new Uint8Array([1])), abort.signal, 3);
  abort.abort();
  await Promise.resolve();
  await Promise.resolve();
  await expect(next.read(0, 1)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.disk.size).toBe(0);
});
