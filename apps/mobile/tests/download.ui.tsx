import { createHash as mockCreateHash } from "node:crypto";
import { ReadableStream as NodeStream } from "node:stream/web";
import { TextDecoder as MockTextDecoder } from "node:util";
import { createExpoDownloads } from "../src/platform/files/expo-download";
import { clearNativeTransferOrphans } from "../src/platform/files/native-cache";

const mockData = new Map<string, Uint8Array>(),
  mockDirectories = new Set<string>();
const mockAvailable = jest.fn(),
  mockShare = jest.fn(),
  mockCanPreview = jest.fn(),
  mockPreview = jest.fn();
let mockOpenFailure = false,
  mockDeleteFailure = false,
  mockDigestFailure = false,
  mockOpenCount = 0,
  mockDigestCount = 0;
let mockDigestDelay: Promise<void> | undefined;
let mockMoveDelay: Promise<void> | undefined;
const path = (...parts: unknown[]) =>
  parts
    .map((part) => (typeof part === "object" && part !== null && "uri" in part ? part.uri : part))
    .join("/");
jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///app/cache" } },
  FileMode: { ReadOnly: "r", WriteOnly: "w" },
  Directory: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = path(...parts);
    }
    get exists() {
      return mockDirectories.has(this.uri);
    }
    create() {
      mockDirectories.add(this.uri);
    }
    list() {
      return [...mockData.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new (jest.requireMock("expo-file-system").File)(key));
    }
    delete() {
      if (mockDeleteFailure) throw new Error("SYNTHETIC_PRIVATE_DELETE");
      mockDirectories.delete(this.uri);
      for (const key of mockData.keys()) if (key.startsWith(`${this.uri}/`)) mockData.delete(key);
    }
  },
  File: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = path(...parts);
    }
    get exists() {
      return mockData.has(this.uri);
    }
    get name() {
      return this.uri.split("/").at(-1) ?? "";
    }
    async move(destination: { uri: string }) {
      await mockMoveDelay;
      const value = mockData.get(this.uri);
      if (!value || mockData.has(destination.uri)) throw new Error("SYNTHETIC_MOVE_FAILED");
      mockData.set(destination.uri, value);
      mockData.delete(this.uri);
      this.uri = destination.uri;
    }
    async digest(algorithm: string) {
      mockDigestCount++;
      await mockDigestDelay;
      if (mockDigestFailure) throw new Error("SYNTHETIC_PRIVATE_DIGEST_FAILED");
      expect(algorithm).toBe("SHA-256");
      return mockCreateHash("sha256")
        .update(mockData.get(this.uri) ?? new Uint8Array())
        .digest("hex");
    }
    get size() {
      return mockData.get(this.uri)?.byteLength ?? 0;
    }
    create() {
      if (this.exists) throw new Error("SYNTHETIC_COLLISION");
      mockData.set(this.uri, new Uint8Array());
    }
    delete() {
      if (mockDeleteFailure) throw new Error("SYNTHETIC_PRIVATE_DELETE");
      mockData.delete(this.uri);
    }
    open(mode: string) {
      mockOpenCount++;
      if (mockOpenFailure) throw new Error("SYNTHETIC_PRIVATE_PERMISSION");
      const name = this.uri;
      return {
        offset: 0,
        get size() {
          return mockData.get(name)?.byteLength ?? 0;
        },
        async writeBytes(bytes: Uint8Array) {
          expect(mode).toBe("w");
          const current = mockData.get(name) ?? new Uint8Array(),
            next = new Uint8Array(current.length + bytes.length);
          next.set(current);
          next.set(bytes, current.length);
          mockData.set(name, next);
        },
        async readBytes(count: number) {
          expect(mode).toBe("r");
          const bytes =
            mockData.get(name)?.slice(this.offset, this.offset + count) ?? new Uint8Array();
          this.offset += bytes.byteLength;
          return bytes;
        },
        close() {},
      };
    }
    async text() {
      return new MockTextDecoder().decode(mockData.get(this.uri));
    }
    canPreview(...args: unknown[]) {
      return mockCanPreview(...args);
    }
    preview(...args: unknown[]) {
      return mockPreview(this.uri, ...args);
    }
  },
}));
const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  root = "file:///app/cache/baro_preview_downloads";
function response(bytes = new Uint8Array([37, 80, 68, 70, 45]), disposition = "") {
  const value = new Response(null, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.length),
      "content-disposition": disposition,
    },
  });
  Object.defineProperty(value, "body", {
    value: new NodeStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  return value;
}
const create = () => createExpoDownloads("baro_preview_downloads", () => id);
beforeEach(() => {
  mockData.clear();
  mockDirectories.clear();
  mockOpenFailure = false;
  mockDeleteFailure = false;
  mockDigestFailure = false;
  mockDigestDelay = undefined;
  mockMoveDelay = undefined;
  mockOpenCount = 0;
  mockDigestCount = 0;
  mockAvailable.mockReset().mockResolvedValue(true);
  mockCanPreview.mockReset().mockResolvedValue(true);
  mockShare.mockReset().mockResolvedValue(undefined);
  mockPreview.mockReset().mockResolvedValue(undefined);
});
test("Expo writes only a random private path, validates signature bytes and uses explicit native preview/share with MIME", async () => {
  mockDirectories.add(root);
  mockData.set(`${root}/orphan`, new Uint8Array([1]));
  mockData.set("file:///app/cache/unrelated", new Uint8Array([2]));
  const cache = create(),
    artifact = await cache.receive(
      response(undefined, "attachment; filename*=UTF-8''..%2F..%2Fsecret.pdf"),
      new AbortController().signal,
      100,
    );
  expect([...mockData.keys()].sort()).toEqual(
    [`${root}/${id}.pdf`, "file:///app/cache/unrelated"].sort(),
  );
  expect([...(await artifact.read(0, 5))]).toEqual([37, 80, 68, 70, 45]);
  await cache.present(
    artifact.value,
    "open",
    { name: "합성.pdf", mimeType: "application/pdf" },
    () => {},
  );
  expect(mockPreview).toHaveBeenCalledWith(`${root}/${id}.pdf`, {
    title: "합성.pdf",
    mimeType: "application/pdf",
  });
  await cache.present(
    artifact.value,
    "share",
    { name: "합성.pdf", mimeType: "application/pdf" },
    () => {},
  );
  expect(mockShare).toHaveBeenCalledWith(`${root}/${id}.pdf`, {
    dialogTitle: "합성.pdf",
    mimeType: "application/pdf",
  });
  await cache.clear();
  expect([...mockData.keys()]).toEqual(["file:///app/cache/unrelated"]);
});
test("SDK permission preflight cannot hand a previous owner's file to an external app", async () => {
  const cache = create(),
    artifact = await cache.receive(response(), new AbortController().signal, 100);
  let resolve!: (value: boolean) => void,
    entered!: () => void,
    owner = "a";
  const started = new Promise<void>((done) => {
    entered = done;
  });
  mockAvailable.mockImplementationOnce(() => {
    entered();
    return new Promise<boolean>((done) => {
      resolve = done;
    });
  });
  const present = cache
    .present(artifact.value, "share", { name: "합성.pdf", mimeType: "application/pdf" }, () => {
      if (owner !== "a") throw new Error("SYNTHETIC_OWNER_CHANGED");
    })
    .catch((error: unknown) => error);
  await started;
  owner = "b";
  resolve(true);
  expect(await present).toMatchObject({ code: "UNAVAILABLE" });
  expect(mockShare).not.toHaveBeenCalled();
  await cache.clear();
});
test("an unavailable preview remains actionable and a failed native open retains the partial file for cleanup", async () => {
  const cache = create(),
    artifact = await cache.receive(response(), new AbortController().signal, 100);
  mockCanPreview.mockResolvedValueOnce(false);
  await expect(
    cache.present(
      artifact.value,
      "open",
      { name: "합성.pdf", mimeType: "application/pdf" },
      () => {},
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: expect.stringContaining("파일 공유") });
  await cache.clear();
  mockOpenFailure = true;
  mockDeleteFailure = true;
  await expect(cache.receive(response(), new AbortController().signal, 100)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(mockData.size).toBe(1);
  mockOpenFailure = false;
  mockDeleteFailure = false;
  mockDigestFailure = false;
  mockOpenCount = 0;
  mockDigestCount = 0;
  mockDigestDelay = undefined;
  mockMoveDelay = undefined;
  await cache.clear();
  expect(mockData.size).toBe(0);
});

const nativeId = "59d91bc4-f715-4205-bc78-60995cb26de4",
  nativeRoot = "file:///app/cache/baro_native_transfers";
const seedNative = () => {
  const value = new Uint8Array([37, 80, 68, 70, 45]);
  mockDirectories.add(nativeRoot);
  mockData.set(`${nativeRoot}/${nativeId}.bin`, value);
  return {
    fileId: nativeId,
    size: value.length,
    sha256: mockCreateHash("sha256").update(value).digest("hex"),
    mimeType: "application/pdf",
    disposition: "attachment; filename*=UTF-8''..%2Fsecret.pdf",
  };
};
test("Expo adoption moves an opaque native file and separately hashes on disk without reading bytes into JS", async () => {
  const value = seedNative(),
    cache = create();
  const artifact = await cache.adopt(value, new AbortController().signal, 1000000000);
  expect(mockData.has(`${nativeRoot}/${nativeId}.bin`)).toBe(false);
  expect(mockData.has(`${root}/${id}.pdf`)).toBe(true);
  expect(mockDigestCount).toBe(1);
  expect(mockOpenCount).toBe(0);
  expect(Object.keys(artifact.value).sort()).toEqual(["mimeType", "sha256", "size"]);
  expect(await artifact.read(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  await artifact.discard();
  expect(mockData.size).toBe(0);
});
test("corrupt metadata or unavailable SDK digest cannot fall back to full JS reads and adopted targets are removed", async () => {
  const value = seedNative(),
    cache = create();
  await expect(
    cache.adopt({ ...value, sha256: "f".repeat(64) }, new AbortController().signal, 1000),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockData.size).toBe(0);
  expect(mockOpenCount).toBe(0);
  seedNative();
  mockDigestFailure = true;
  await expect(cache.adopt(value, new AbortController().signal, 1000)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(mockData.size).toBe(0);
  expect(mockOpenCount).toBe(0);
});
test("cache clear waits for native digest completion and cannot publish a file verified after abort", async () => {
  let release!: () => void;
  mockDigestDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  const value = seedNative(),
    cache = create(),
    pending = cache
      .adopt(value, new AbortController().signal, 1000)
      .catch((error: unknown) => error);
  for (let i = 0; i < 40 && !mockDigestCount; i++) await Promise.resolve();
  expect(mockDigestCount).toBe(1);
  let done = false;
  const clearing = cache.clear().then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(mockData.has(`${root}/${id}.pdf`)).toBe(true);
  release();
  await clearing;
  expect(await pending).toBeInstanceOf(Error);
  expect(mockData.size).toBe(0);
});
test("missing-module startup cleanup removes recognized native orphans and preserves unexpected/unrelated files", () => {
  seedNative();
  mockData.set(`${nativeRoot}/${nativeId}.upload`, new Uint8Array([1]));
  mockData.set("file:///app/cache/unrelated", new Uint8Array([1]));
  clearNativeTransferOrphans();
  expect(mockData.has(`${nativeRoot}/${nativeId}.bin`)).toBe(false);
  expect(mockData.has(`${nativeRoot}/${nativeId}.upload`)).toBe(false);
  expect(mockData.has("file:///app/cache/unrelated")).toBe(true);
  mockData.set(`${nativeRoot}/unexpected`, new Uint8Array([1]));
  expect(() => clearNativeTransferOrphans()).toThrow();
  expect(mockData.has(`${nativeRoot}/unexpected`)).toBe(true);
});

test("concurrent adoption cannot reserve the same destination or delete the other transfer's owned target", async () => {
  const first = seedNative(),
    secondId = "5c0dba77-178e-44b4-a3a8-bcb3526f83cb";
  mockData.set(`${nativeRoot}/${secondId}.bin`, new Uint8Array([37, 80, 68, 70, 45]));
  let finish!: () => void;
  mockMoveDelay = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cache = create(),
    pending = cache.adopt(first, new AbortController().signal, 1000);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await expect(
    cache.adopt({ ...first, fileId: secondId }, new AbortController().signal, 1000),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  finish();
  const artifact = await pending;
  expect(mockData.has(`${root}/${id}.pdf`)).toBe(true);
  expect(await artifact.read(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
  await artifact.discard();
  expect(mockData.has(`${nativeRoot}/${secondId}.bin`)).toBe(true);
});
