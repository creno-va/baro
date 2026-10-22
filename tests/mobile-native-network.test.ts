import { expect, test } from "bun:test";
import { ApiError } from "@baro/api-client";
import {
  createNativeDiskJobs,
  type NativeDiskPort,
  type NativeDiskRequest,
  type NativeDiskResult,
} from "../apps/mobile/src/platform/files/native-jobs";

const request: NativeDiskRequest = {
  url: "https://preview.baro.site/api/v2/reports/synthetic/pdf",
  origin: "https://preview.baro.site",
  method: "GET",
  headers: { origin: "https://preview.baro.site" },
  maximum: 1000000000,
};
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const reserved: string[] = [],
    canceled: string[] = [],
    released: string[] = [];
  let clears = 0,
    failRelease = false;
  const valid = (id: string): NativeDiskResult => ({
    status: 200,
    headers: { "content-type": "application/pdf" },
    size: 1000000000,
    sha256: "a".repeat(64),
    fileId: id,
    body: "",
    maxCopyBytes: 65536,
  });
  let download = async (id: string): Promise<unknown> => valid(id);
  const native: NativeDiskPort = {
    reserve() {
      const id = crypto.randomUUID();
      reserved.push(id);
      return id;
    },
    download: (id) => download(id),
    cancel: (id) => {
      canceled.push(id);
    },
    async release(id) {
      released.push(id);
      if (failRelease) throw new Error("SYNTHETIC_PRIVATE_PATH_COOKIE");
    },
    async clear() {
      clears++;
    },
  };
  return {
    jobs: createNativeDiskJobs(native),
    valid,
    reserved,
    canceled,
    released,
    clears: () => clears,
    failRelease: (value: boolean) => {
      failRelease = value;
    },
    download: (value: typeof download) => {
      download = value;
    },
  };
}
test("native transfers lease only bounded metadata and always release their opaque file after adoption", async () => {
  const f = fixture();
  const value = await f.jobs.run(request, new AbortController().signal, async (result, context) => {
    context.ensure();
    expect(result.fileId).toBe(f.reserved[0] ?? "missing");
    expect("uri" in result).toBe(false);
    expect(result.size).toBe(1000000000);
    return "synthetic-adopted-handle";
  });
  expect(value).toBe("synthetic-adopted-handle");
  expect(f.released).toEqual(f.reserved);
});
test("malformed native IDs/length/hash/window/URI or unbounded errors are rejected before adoption", async () => {
  const invalid: Partial<NativeDiskResult>[] = [
    { fileId: crypto.randomUUID() },
    { size: 1000000001 },
    { sha256: "INVALID" },
    { maxCopyBytes: 65537 },
    { status: 302 },
    { status: 401, fileId: "", size: 0, sha256: "", body: "x".repeat(65537) },
  ];
  for (const mutation of [...invalid, { uri: "file:///synthetic/private" }]) {
    const f = fixture();
    let adopted = false;
    f.download(async (id) => ({ ...f.valid(id), ...mutation }));
    await expect(
      f.jobs.run(request, new AbortController().signal, async () => {
        adopted = true;
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(adopted).toBe(false);
    expect(f.released).toEqual(f.reserved);
  }
});
test("HTTP error metadata stays bounded and safe consumer errors preserve their meaning", async () => {
  const f = fixture();
  f.download(async () => ({
    status: 401,
    headers: { "set-cookie": "synthetic_expired=; Max-Age=0" },
    size: 0,
    sha256: "",
    fileId: "",
    body: '{"error":{"code":"UNAUTHENTICATED"}}',
    maxCopyBytes: 36,
  }));
  await expect(
    f.jobs.run(request, new AbortController().signal, async (result) => {
      expect(result.status).toBe(401);
      expect(result.fileId).toBe("");
      throw new ApiError("UNAUTHENTICATED", "합성 세션 확인");
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.released).toEqual(f.reserved);
});
test("abort before allocation and while native IO is pending cannot publish or skip cleanup", async () => {
  const f = fixture(),
    before = new AbortController();
  before.abort();
  await expect(f.jobs.run(request, before.signal, async () => {})).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.reserved).toEqual([]);
  const transfer = deferred<unknown>(),
    abort = new AbortController();
  let adopted = false;
  f.download(() => transfer.promise);
  const pending = f.jobs.run(request, abort.signal, async () => {
    adopted = true;
  });
  await tick();
  abort.abort();
  expect(f.canceled).toEqual(f.reserved);
  transfer.resolve(f.valid(f.reserved[0] ?? ""));
  await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(adopted).toBe(false);
  expect(f.released).toEqual(f.reserved);
});
test("clear waits for IO/consumer/cleanup and new requests cannot overtake its generation fence", async () => {
  const f = fixture(),
    consume = deferred<void>();
  let entered = false,
    published = false;
  const pending = f.jobs.run(request, new AbortController().signal, async (_value, context) => {
    entered = true;
    await consume.promise;
    context.ensure();
    published = true;
  });
  await tick();
  expect(entered).toBe(true);
  const clearing = f.jobs.clear();
  const next = f.jobs.run(request, new AbortController().signal, async () => "new owner");
  await tick();
  expect(f.reserved.length).toBe(1);
  expect(f.clears()).toBe(0);
  consume.resolve();
  await expect(pending).rejects.toBeDefined();
  await clearing;
  expect(published).toBe(false);
  expect(await next).toBe("new owner");
  expect(f.clears()).toBe(1);
  const early = fixture(),
    racing = early.jobs.run(request, new AbortController().signal, async () => "old generation");
  await early.jobs.clear();
  await expect(racing).rejects.toBeDefined();
  expect(early.reserved).toEqual([]);
});
test("failed native release retains retry work without turning a successfully adopted artifact into a failed download", async () => {
  const f = fixture();
  f.failRelease(true);
  expect(await f.jobs.run(request, new AbortController().signal, async () => "accepted")).toBe(
    "accepted",
  );
  await expect(f.jobs.clear()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  f.failRelease(false);
  await f.jobs.clear();
  expect(f.clears()).toBe(1);
  expect(f.released.filter((id) => id === f.reserved[0]).length).toBe(3);
});
test("origin/body guards and raw native failures never expose credentials or paths", async () => {
  for (const input of [
    { ...request, url: "https://example.invalid/api/file" },
    { ...request, body: "not a GET body" },
    { ...request, maximum: 1.1 },
  ]) {
    const f = fixture();
    await expect(
      f.jobs.run(input, new AbortController().signal, async () => {}),
    ).rejects.toBeDefined();
    expect(f.reserved).toEqual([]);
  }
  const f = fixture();
  f.download(async () => {
    throw new Error("SYNTHETIC_PRIVATE_PATH_COOKIE");
  });
  try {
    await f.jobs.run(request, new AbortController().signal, async () => {});
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_PATH_COOKIE");
  }
  expect(f.released).toEqual(f.reserved);
});
