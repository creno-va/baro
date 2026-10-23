import { createExpoUploadSources } from "../src/platform/files/documents";

const mockFiles = new Map<string, Uint8Array>(),
  mockDirectories = new Set<string>();
let mockIgnoreDelete = false,
  mockOpened = 0,
  mockClosed = 0;
let mockRead: () => Promise<void> = async () => {};
const mockPick = jest.fn();
const uri = (...parts: unknown[]) =>
  parts
    .map((part) => (typeof part === "object" && part !== null && "uri" in part ? part.uri : part))
    .join("/");
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockPick(...args),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///app/cache" } },
  FileMode: { ReadOnly: "read-only" },
  Directory: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uri(...parts);
    }
    get exists() {
      return mockDirectories.has(this.uri);
    }
    create() {
      mockDirectories.add(this.uri);
    }
    delete() {
      if (mockIgnoreDelete) return;
      mockDirectories.delete(this.uri);
      for (const key of mockFiles.keys()) if (key.startsWith(`${this.uri}/`)) mockFiles.delete(key);
    }
  },
  File: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uri(...parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.byteLength ?? 0;
    }
    get name() {
      return this.uri.split("/").at(-1) ?? "";
    }
    delete() {
      if (!mockIgnoreDelete) mockFiles.delete(this.uri);
    }
    async move(destination: { uri: string }) {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error("SYNTHETIC_URI_REVOKED");
      mockFiles.set(destination.uri, bytes);
      mockFiles.delete(this.uri);
      this.uri = destination.uri;
    }
    open(mode: string) {
      expect(mode).toBe("read-only");
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error("SYNTHETIC_URI_REVOKED");
      mockOpened++;
      return {
        size: bytes.byteLength,
        offset: 0,
        async readBytes(count: number) {
          await mockRead();
          const value = bytes.slice(this.offset, this.offset + count);
          this.offset += value.byteLength;
          return value;
        },
        close() {
          mockClosed++;
        },
      };
    }
  },
}));
const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  root = "file:///app/cache/baro_preview_uploads";
const asset = {
  uri: "file:///app/cache/picker/synthetic.txt",
  name: "합성.txt",
  size: 3,
  mimeType: "text/plain",
};
const signal = () => new AbortController().signal;
const create = () =>
  createExpoUploadSources({ namespace: "baro_preview_uploads", newId: () => id });

test("native source leases expose only generated filenames and clear waits for a concurrently retiring source", async () => {
  const sources = create(),
    source = await sources.select(signal());
  if (!source) throw new Error("SYNTHETIC_PICK_REQUIRED");
  let finish!: () => void,
    entered!: () => void,
    aborted = false;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transfer = sources
    .withNativeSource(source, signal(), async (context) => {
      expect(context.sourceName).toBe(id);
      expect("uri" in context).toBe(false);
      context.signal.addEventListener("abort", () => {
        aborted = true;
      });
      entered();
      await held;
      return "native-finished";
    })
    .catch((error: unknown) => error);
  await ready;
  const release = sources.release(source);
  let cleared = false;
  const clear = sources.clear().then(() => {
    cleared = true;
  });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(aborted).toBe(true);
  expect(cleared).toBe(false);
  expect(mockFiles.has(`${root}/${id}`)).toBe(true);
  await expect(
    sources.withNativeSource({ ...source }, signal(), async () => "forged"),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  finish();
  await release;
  await clear;
  expect(await transfer).toMatchObject({ code: "UNAVAILABLE" });
  expect(mockFiles.has(`${root}/${id}`)).toBe(false);
});
beforeEach(() => {
  mockFiles.clear();
  mockDirectories.clear();
  mockIgnoreDelete = false;
  mockOpened = 0;
  mockClosed = 0;
  mockRead = async () => {};
  mockFiles.set(asset.uri, new Uint8Array([97, 98, 99]));
  mockPick.mockReset().mockResolvedValue({ canceled: false, assets: [asset] });
});

test("system picker snapshot is opaque, read-only and hashed as actual bytes; startup clears only its own orphan directory", async () => {
  mockDirectories.add(root);
  mockFiles.set(`${root}/orphan`, new Uint8Array([1]));
  mockFiles.set("file:///app/cache/unrelated", new Uint8Array([2]));
  const sources = create(),
    source = await sources.select(signal());
  if (!source) throw new Error("SYNTHETIC_PICK_REQUIRED");
  expect(source).toEqual({ name: "합성.txt", size: 3, type: "text/plain" });
  expect(Object.isFrozen(source)).toBe(true);
  expect(JSON.stringify(source)).not.toContain("file:");
  expect(mockPick).toHaveBeenCalledWith({
    copyToCacheDirectory: true,
    multiple: false,
    type: "*/*",
    base64: false,
  });
  expect(mockFiles.has(`${root}/orphan`)).toBe(false);
  expect(mockFiles.has(asset.uri)).toBe(false);
  const reader = await sources.openUpload(source, signal());
  expect(await reader.fingerprint()).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const part = await reader.part(0, 3);
  expect([...new Uint8Array(part.body as ArrayBuffer)]).toEqual([97, 98, 99]);
  await sources.release(source);
  await expect(reader.part(0, 3)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockOpened).toBe(mockClosed);
  expect([...mockFiles.keys()]).toEqual(["file:///app/cache/unrelated"]);
});
test("abort or retirement during picker delivery removes the app-owned copy and never publishes a source", async () => {
  for (const retire of ["abort", "clear"] as const) {
    const sources = create(),
      controller = new AbortController();
    mockFiles.set(asset.uri, new Uint8Array([97, 98, 99]));
    mockPick.mockImplementationOnce(async () => {
      if (retire === "abort") controller.abort();
      else await sources.clear();
      return { canceled: false, assets: [asset] };
    });
    await expect(sources.select(controller.signal)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(mockFiles.has(asset.uri)).toBe(false);
    expect(mockFiles.has(`${root}/${id}`)).toBe(false);
  }
});
test("mismatched picker size and revoked cache bytes are safe failures; external original URIs are never removed", async () => {
  const sources = create();
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, size: 4 }] });
  await expect(sources.select(signal())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  mockFiles.set("file:///user/original.txt", new Uint8Array([1]));
  mockPick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ ...asset, uri: "file:///user/original.txt" }],
  });
  await expect(sources.select(signal())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockFiles.has("file:///user/original.txt")).toBe(true);
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [asset] });
  await expect(sources.select(signal())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
test("silent deletion fails and retains cleanup work, while a later explicit clear recovers", async () => {
  const sources = create(),
    source = await sources.select(signal());
  if (!source) throw new Error("SYNTHETIC_PICK_REQUIRED");
  mockIgnoreDelete = true;
  await expect(sources.release(source)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(sources.openUpload(source, signal())).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(mockFiles.has(`${root}/${id}`)).toBe(true);
  mockIgnoreDelete = false;
  await sources.clear();
  expect(mockFiles.has(`${root}/${id}`)).toBe(false);
});
test("a cancelled picker has no source and forged metadata cannot resolve to an owned file", async () => {
  const sources = create();
  mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await sources.select(signal())).toBeNull();
  await expect(
    sources.openUpload({ name: "合成.txt", size: 3, type: "text/plain" }, signal()),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

test("an ID collision cleans only the new picker copy and preserves the already selected snapshot", async () => {
  const sources = create(),
    first = await sources.select(signal());
  if (!first) throw new Error("SYNTHETIC_PICK_REQUIRED");
  mockFiles.set(asset.uri, new Uint8Array([100, 101, 102]));
  await expect(sources.select(signal())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockFiles.has(asset.uri)).toBe(false);
  const reader = await sources.openUpload(first, signal());
  const part = await reader.part(0, 3);
  expect([...new Uint8Array(part.body as ArrayBuffer)]).toEqual([97, 98, 99]);
  await sources.clear();
});

test("clear retires the source immediately and waits for an awaited descriptor to close before deleting its bytes", async () => {
  const sources = create(),
    source = await sources.select(signal());
  if (!source) throw new Error("SYNTHETIC_PICK_REQUIRED");
  let enter = () => {},
    release = () => {};
  const entered = new Promise<void>((done) => {
    enter = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  mockRead = async () => {
    enter();
    await held;
  };
  const reader = await sources.openUpload(source, signal());
  const hashing = reader.fingerprint().catch((error: unknown) => error);
  await entered;
  const clearing = sources.clear();
  await expect(sources.openUpload(source, signal())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockFiles.has(`${root}/${id}`)).toBe(true);
  release();
  expect(await hashing).toMatchObject({ code: "UNAVAILABLE" });
  await clearing;
  expect(mockFiles.has(`${root}/${id}`)).toBe(false);
  expect(mockOpened).toBe(mockClosed);
});
