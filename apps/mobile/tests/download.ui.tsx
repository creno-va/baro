import { ReadableStream as NodeStream } from "node:stream/web";
import { TextDecoder as MockTextDecoder } from "node:util";
import { createExpoDownloads } from "../src/platform/files/expo-download";

const mockData = new Map<string, Uint8Array>(),
  mockDirectories = new Set<string>();
const mockAvailable = jest.fn(),
  mockShare = jest.fn(),
  mockCanPreview = jest.fn(),
  mockPreview = jest.fn();
let mockOpenFailure = false,
  mockDeleteFailure = false;
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
  await cache.clear();
  expect(mockData.size).toBe(0);
});
