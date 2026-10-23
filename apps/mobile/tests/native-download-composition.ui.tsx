import { createHash as mockHash, randomUUID as mockUUID } from "node:crypto";
import { TextEncoder as MockEncoder } from "node:util";
import { createSessionScope } from "@baro/client-core";
import type { NativeDiskPort, NativeDiskRequest } from "../src/platform/files/native-jobs";

let mockScope = createSessionScope(),
  mockModuleAvailable = true,
  mockPort: NativeDiskPort;
const mockEvents: string[] = [],
  mockRequests: NativeDiskRequest[] = [],
  mockNativeData = new Map<string, Uint8Array>(),
  mockOperations = new Map<string, string>();
let mockNativeWait: Promise<void> | undefined;
let mockCreateSourcesFailure = false;
const mockJsonFetch = jest.fn(),
  mockAdopt = jest.fn(),
  mockSdkReceive = jest.fn();
const mockCache = {
  clear: async () => {
    mockEvents.push("cache-clear");
  },
  adopt: (input: unknown) => mockAdopt(input),
  receive: (...args: unknown[]) => mockSdkReceive(...args),
};
jest.mock("expo", () => ({
  requireOptionalNativeModule: () => (mockModuleAvailable ? mockPort : null),
}));
jest.mock("expo/fetch", () => ({ fetch: (...args: unknown[]) => mockJsonFetch(...args) }));
jest.mock("expo-crypto", () => ({
  randomUUID: () => mockUUID(),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    mockHash("sha256").update(value).digest("hex"),
}));
jest.mock("../src/composition/config", () => ({
  readMobileConfig: () => ({
    environment: "preview",
    applicationId: "site.baro.app.preview",
    apiBaseUrl: "https://preview.baro.site",
    name: "BARO Preview",
    scheme: "baro-preview",
  }),
}));
jest.mock("../src/composition/credentials", () => ({
  getMobileCredentials: () => ({
    scope: mockScope,
    credentials: {
      capture: () => {
        const generation = mockScope.snapshot();
        return {
          generation,
          storage: {},
          cookie: async () => "fixture-session=owner",
          accept: async () => {
            if (!mockScope.isCurrent(generation)) throw new Error("RETIRED_FIXTURE_FRAME");
          },
        };
      },
    },
  }),
}));
jest.mock("../src/composition/cases", () => ({
  getCaseOperationStorage: () => ({
    getItem: async (key: string) => mockOperations.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockOperations.set(key, value);
    },
    removeItem: async (key: string) => {
      mockOperations.delete(key);
    },
  }),
}));
jest.mock("../src/platform/files/documents", () => ({
  createExpoUploadSources: () => {
    if (mockCreateSourcesFailure) {
      mockCreateSourcesFailure = false;
      throw new Error("SYNTHETIC_LOCKED_SDK_FACTORY");
    }
    return {
      clear: async () => {
        mockEvents.push("upload-clear");
      },
      openUpload: async () => {
        throw new Error("UPLOAD_NOT_IN_DOWNLOAD_TEST");
      },
    };
  },
}));
jest.mock("../src/platform/files/expo-download", () => ({ createExpoDownloads: () => mockCache }));
jest.mock("../src/platform/files/native-cache", () => ({
  clearNativeTransferOrphans: () => {
    mockEvents.push("missing-module-orphans");
  },
}));
const html = '<!doctype html><html data-baro-report="1"></html>';
beforeEach(() => {
  jest.resetModules();
  mockScope = createSessionScope();
  mockModuleAvailable = true;
  mockNativeWait = undefined;
  mockCreateSourcesFailure = false;
  mockEvents.length = 0;
  mockRequests.length = 0;
  mockNativeData.clear();
  mockOperations.clear();
  mockJsonFetch.mockReset().mockRejectedValue(new Error("JS_BINARY_FETCH_MUST_NOT_RUN"));
  mockSdkReceive.mockReset().mockRejectedValue(new Error("SDK_BYTE_QUEUE_MUST_NOT_RUN"));
  mockAdopt
    .mockReset()
    .mockImplementation(
      async (input: { fileId: string; size: number; sha256: string; mimeType: string }) => {
        const bytes = mockNativeData.get(input.fileId);
        if (!bytes) throw new Error("MISSING_FIXTURE_FILE");
        mockNativeData.delete(input.fileId);
        mockEvents.push("adopt");
        const value = Object.freeze({
          size: input.size,
          sha256: input.sha256,
          mimeType: input.mimeType,
        });
        return {
          value,
          size: input.size,
          mimeType: input.mimeType,
          read: async (start: number, end: number) => bytes.slice(start, end),
          text: async () => html,
          discard: async () => {
            mockEvents.push("discard");
          },
        };
      },
    );
  mockPort = {
    reserve: () => mockUUID(),
    download: async (id, request) => {
      mockRequests.push(request);
      mockEvents.push("native-download");
      await mockNativeWait;
      const pathname = new URL(request.url).pathname,
        isHtml = pathname.endsWith("/html"),
        isZip = pathname.endsWith("/zip");
      const bytes = isHtml
        ? new MockEncoder().encode(html)
        : isZip
          ? new Uint8Array([0x50, 0x4b, 3, 4, 0])
          : new Uint8Array([37, 80, 68, 70, 45]);
      const type = isHtml
        ? "text/html"
        : isZip
          ? "application/zip"
          : pathname.endsWith("/content")
            ? "application/octet-stream"
            : "application/pdf";
      mockNativeData.set(id, bytes);
      return {
        status: 200,
        headers: { "content-type": type, "content-length": String(bytes.length) },
        size: bytes.length,
        fileId: id,
        sha256: mockHash("sha256").update(bytes).digest("hex"),
        body: "",
        maxCopyBytes: bytes.length,
      };
    },
    cancel: () => {
      mockEvents.push("native-cancel");
    },
    release: async (id) => {
      mockEvents.push("native-release");
      mockNativeData.delete(id);
    },
    clear: async () => {
      mockEvents.push("native-clear");
      mockNativeData.clear();
    },
  };
});
function files() {
  return require("../src/composition/files") as typeof import("../src/composition/files");
}
function reports() {
  return require("../src/composition/reports") as typeof import("../src/composition/reports");
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (ready()) return;
    await Promise.resolve();
  }
  throw new Error("FIXTURE_IO_DID_NOT_START");
}

test("real compositions route original/PDF/HTML/saved ZIP/selected POST through native metadata and retain durable selection key", async () => {
  const f = files(),
    r = reports();
  const original = await f
    .createNativeFiles(new AbortController().signal, "owner_a", () => {})
    .original("case_a", "file_a");
  expect(original.size).toBe(5);
  expect(mockEvents.indexOf("native-clear")).toBeLessThan(mockEvents.indexOf("cache-clear"));
  expect(mockEvents.indexOf("cache-clear")).toBeLessThan(mockEvents.indexOf("native-download"));
  let nativeReports = r.createNativeReports(new AbortController().signal, "owner_a").reports;
  await nativeReports.pdf("report_a");
  await nativeReports.html("report_a");
  await nativeReports.savedZip("report_a");
  await nativeReports.zip("report_a", ["file_a"]);
  // Recreate the feature with unresolved export key still in the same required operation store.
  nativeReports = r.createNativeReports(new AbortController().signal, "owner_a").reports;
  await nativeReports.zip("report_a", ["file_a"]);
  expect(mockRequests.map((value) => new URL(value.url).pathname)).toEqual([
    "/api/v2/cases/case_a/files/file_a/content",
    "/api/v2/reports/report_a/pdf",
    "/api/v2/reports/report_a/html",
    "/api/v2/reports/report_a/zip",
    "/api/v2/reports/report_a/zip",
    "/api/v2/reports/report_a/zip",
  ]);
  const posts = mockRequests.filter((value) => value.method === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[0]?.body).toBe(JSON.stringify({ selectedFileIds: ["file_a"] }));
  expect(posts[0]?.headers["idempotency-key"]).toBe(posts[1]?.headers["idempotency-key"]);
  expect(
    mockRequests.every(
      (value) =>
        value.headers.cookie === "fixture-session=owner" &&
        value.headers["x-baro-expected-owner"] === "owner_a",
    ),
  ).toBe(true);
  expect(mockJsonFetch).not.toHaveBeenCalled();
  expect(mockSdkReceive).not.toHaveBeenCalled();
});

test("missing native module cleans recognized startup orphans and gives an actionable download error without SDK fallback", async () => {
  mockModuleAvailable = false;
  const f = files();
  await f.privateFilesReady();
  expect(mockEvents).toContain("missing-module-orphans");
  await expect(
    f
      .createNativeFiles(new AbortController().signal, "owner_a", () => {})
      .original("case_a", "file_a"),
  ).rejects.toMatchObject({
    code: "UNAVAILABLE",
    message: "파일 저장 기능을 사용하려면 최신 개발 앱을 설치해 주세요.",
  });
  expect(mockJsonFetch).not.toHaveBeenCalled();
  expect(mockSdkReceive).not.toHaveBeenCalled();
  expect(mockAdopt).not.toHaveBeenCalled();
});

test("real reset waits for native cancellation/release before owned cache cleanup and keeps unresolved server keys", async () => {
  const f = files();
  await f.privateFilesReady();
  mockEvents.length = 0;
  mockOperations.set("synthetic-unresolved-server-key", "opaque");
  let release!: () => void;
  mockNativeWait = new Promise<void>((done) => {
    release = done;
  });
  const result = f
    .createNativeFiles(new AbortController().signal, "owner_a", () => {})
    .original("case_a", "file_a")
    .catch((error: unknown) => error);
  await until(() => !!mockRequests.length);
  let complete = false;
  const clearing = f.resetPrivateFiles().then(() => {
    complete = true;
  });
  await until(() => mockEvents.includes("native-cancel"));
  expect(complete).toBe(false);
  expect(mockEvents).not.toContain("cache-clear");
  release();
  await clearing;
  expect(await result).toBeInstanceOf(Error);
  expect(mockEvents.indexOf("native-release")).toBeLessThan(mockEvents.indexOf("cache-clear"));
  expect(mockAdopt).not.toHaveBeenCalled();
  expect(mockOperations.get("synthetic-unresolved-server-key")).toBe("opaque");
});

test("a synchronously unavailable upload adapter cannot skip native startup cleanup and the next ready call retries", async () => {
  mockCreateSourcesFailure = true;
  const f = files();
  await expect(f.privateFilesReady()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockEvents).toContain("native-clear");
  expect(mockEvents).toContain("cache-clear");
  await f.privateFilesReady();
  expect(mockEvents).toContain("upload-clear");
});
