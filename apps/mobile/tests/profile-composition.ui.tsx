import { createHash as mockHash, randomUUID as mockUUID } from "node:crypto";
import { TextEncoder as MockEncoder } from "node:util";
import { createSessionScope } from "@baro/client-core";
import {
  createNativeDiskJobs,
  type NativeDiskUploadRequest,
} from "../src/platform/files/native-jobs";

let mockScope = createSessionScope(),
  mockJobs: ReturnType<typeof createNativeDiskJobs>,
  mockUploaded = false,
  mockLoseAck = false,
  mockAvailable = true;
const mockRecords = new Map<string, string>(),
  mockNativeFiles = new Map<string, string>(),
  mockRequests: NativeDiskUploadRequest[] = [];
const mockJson = jest.fn(),
  mockSourceOpen = jest.fn(),
  mockSourceLease = jest.fn(),
  mockBody = jest.fn(),
  mockClose = jest.fn(),
  mockDiscard = jest.fn();
const mockSource = Object.freeze({ name: "합성 비공개 사진.png", type: "image/png", size: 3 });
const mockSourceName = "00000000-0000-4000-8000-000000000001";
let mockWait: Promise<void> | undefined;
jest.mock("expo-crypto", () => ({
  randomUUID: () => mockUUID(),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    mockHash("sha256").update(value).digest("hex"),
}));
jest.mock("../src/composition/config", () => ({
  readMobileConfig: () => ({ environment: "preview", apiBaseUrl: "https://preview.baro.site" }),
}));
jest.mock("../src/composition/credentials", () => ({
  getMobileCredentials: () => ({
    scope: mockScope,
    credentials: {
      capture: () => {
        const generation = mockScope.snapshot();
        return {
          generation,
          cookie: async () => "fixture-session=owner",
          accept: async () => {
            if (!mockScope.isCurrent(generation)) throw new Error("RETIRED_FRAME");
          },
        };
      },
    },
  }),
}));
jest.mock("../src/composition/api", () => ({
  getMobileApi: () => ({ request: (...args: unknown[]) => mockJson(...args) }),
}));
jest.mock("../src/composition/cases", () => ({
  getCaseOperationStorage: () => {
    const { createCaseOperationStorage } =
      require("../src/platform/storage/case-operations") as typeof import("../src/platform/storage/case-operations");
    return createCaseOperationStorage({
      namespace: "baro_preview_case_operations",
      fingerprint: async (value) => mockHash("sha256").update(value).digest("hex"),
      storage: {
        get: async (key) => mockRecords.get(key) ?? null,
        set: async (key, value) => {
          mockRecords.set(key, value);
        },
        remove: async (key) => {
          mockRecords.delete(key);
        },
      },
    });
  },
}));
jest.mock("../src/composition/files", () => ({
  privateFilesReady: async () => {},
  getNativeDiskJobs: () => mockJobs,
  getNativeUploadSources: () => ({
    openUpload: (...args: unknown[]) => mockSourceOpen(...args),
    withNativeSource: (...args: unknown[]) => mockSourceLease(...args),
  }),
  getNativeDownloads: () => ({
    adopt: async (input: { fileId: string; size: number; mimeType: string }) => {
      const text = mockNativeFiles.get(input.fileId);
      if (!text) throw new Error("NO_FIXTURE_JSON");
      mockNativeFiles.delete(input.fileId);
      return {
        value: { size: input.size, mimeType: input.mimeType },
        text: async () => text,
        discard: () => mockDiscard(),
      };
    },
  }),
}));
const uploaded = {
  id: "asset_a",
  revision: 2,
  kind: "image",
  status: "uploaded",
  byteLength: 3,
  originalHash: "a".repeat(64),
  sanitizedDerivative: null,
  currentJobId: null,
  failure: null,
};
beforeEach(() => {
  mockScope = createSessionScope();
  mockUploaded = false;
  mockLoseAck = false;
  mockAvailable = true;
  mockWait = undefined;
  mockRecords.clear();
  mockNativeFiles.clear();
  mockRequests.length = 0;
  mockBody.mockReset().mockRejectedValue(new Error("JS_SOURCE_BODY_MUST_NOT_RUN"));
  mockClose.mockReset().mockResolvedValue(undefined);
  mockDiscard.mockReset().mockResolvedValue(undefined);
  mockSourceOpen.mockReset().mockResolvedValue({
    fingerprint: async () => "a".repeat(64),
    close: () => mockClose(),
    body: () => mockBody(),
  });
  mockSourceLease.mockReset().mockImplementation(async (source, signal, consume) => {
    if (source !== mockSource) throw new Error("FORGED_SOURCE");
    return consume({ sourceName: mockSourceName, signal });
  });
  mockJson.mockReset().mockImplementation(async (options: { path: string; method?: string }) => {
    if (options.path.endsWith("/profile")) return { profileId: "profile_a", revision: 1 };
    if (options.method === "POST")
      return { assetId: "asset_a", revision: 1, value: { request: { mediaType: "image/png" } } };
    if (options.path.endsWith("/portfolio-assets/asset_a")) return uploaded;
    throw new Error("UNEXPECTED_FIXTURE_JSON");
  });
  mockJobs = createNativeDiskJobs({
    reserve: () => mockUUID(),
    download: async () => {
      throw new Error("NO_DOWNLOAD");
    },
    upload: async (id, request) => {
      if (!mockAvailable) throw new Error("UNAVAILABLE");
      mockRequests.push(request);
      await mockWait;
      mockUploaded = true;
      if (mockLoseAck) throw new Error("SYNTHETIC_ACK_LOSS_AFTER_WRITE");
      const text = JSON.stringify({ assetId: "asset_a", revision: 2, value: uploaded });
      mockNativeFiles.set(id, text);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        size: new MockEncoder().encode(text).length,
        sha256: mockHash("sha256").update(text).digest("hex"),
        fileId: id,
        body: "",
        maxCopyBytes: 512,
      };
    },
    cancel() {},
    release: async (id) => {
      mockNativeFiles.delete(id);
    },
    clear: async () => {
      mockNativeFiles.clear();
    },
  });
});
function composition() {
  return require("../src/composition/profile") as typeof import("../src/composition/profile");
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await Promise.resolve();
  }
  throw new Error("SYNTHETIC_COMPOSITION_DID_NOT_ADVANCE");
}
test("actual profile composition persists opaque upload intent, reserves with captured owner/profile and selects native source port before any JS body", async () => {
  const client = composition().createNativeProfile(new AbortController().signal, "owner_a");
  expect(await client.assets.upload("profile_a", mockSource, "profile_photo")).toMatchObject({
    id: "asset_a",
    status: "uploaded",
  });
  expect(mockSourceLease).toHaveBeenCalledTimes(1);
  expect(mockBody).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(mockRequests[0]).toMatchObject({
    method: "PUT",
    sourceName: mockSourceName,
    byteLength: 3,
    contentHash: "a".repeat(64),
    headers: {
      cookie: "fixture-session=owner",
      "x-baro-expected-owner": "owner_a",
      "if-match": "1",
    },
  });
  const reserve = mockJson.mock.calls.map((call) => call[0]).find((call) => call.method === "POST");
  expect(reserve).toMatchObject({
    expectedOwner: "owner_a",
    headers: { "x-baro-expected-profile": "profile_a" },
    key: expect.any(String),
  });
  expect(mockRecords.size).toBe(0);
  expect(mockNativeFiles.size).toBe(0);
});
test("lost native upload ACK survives feature/auth recreation and authoritative uploaded status retires intent without another byte PUT or reservation", async () => {
  mockLoseAck = true;
  const client = composition().createNativeProfile(new AbortController().signal, "owner_a");
  await expect(
    client.assets.upload("profile_a", mockSource, "profile_photo"),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(mockUploaded).toBe(true);
  expect(mockRecords.size).toBe(1);
  const stored = [...mockRecords.values()][0] ?? "";
  expect(stored).not.toContain(mockSource.name);
  expect(stored).not.toContain("owner_a");
  mockScope.invalidate();
  mockScope = createSessionScope();
  mockLoseAck = false;
  const fresh = composition().createNativeProfile(new AbortController().signal, "owner_a");
  expect(await fresh.assets.upload("profile_a", mockSource, "profile_photo")).toMatchObject({
    status: "uploaded",
  });
  expect(mockRequests).toHaveLength(1);
  expect(mockJson.mock.calls.filter((call) => call[0].method === "POST")).toHaveLength(1);
  expect(mockRecords.size).toBe(0);
  expect(mockBody).not.toHaveBeenCalled();
});
test("a retired feature cannot publish a late native ACK or delete the unresolved recovery record", async () => {
  let release!: () => void;
  mockWait = new Promise<void>((done) => {
    release = done;
  });
  const client = composition().createNativeProfile(new AbortController().signal, "owner_a");
  const result = client.assets
    .upload("profile_a", mockSource, "profile_photo")
    .catch((error: unknown) => error);
  await until(() => !!mockRequests.length);
  mockScope.invalidate();
  release();
  expect(await result).toMatchObject({ code: "UNAUTHENTICATED" });
  expect(mockRecords.size).toBe(1);
  expect(mockNativeFiles.size).toBe(0);
  expect(mockBody).not.toHaveBeenCalled();
});
