import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createSessionScope } from "@baro/client-core";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import {
  createPrivateDownloads,
  type DownloadDiskFile,
} from "../apps/mobile/src/platform/files/download";
import {
  createNativeDiskJobs,
  type NativeDiskUploadRequest,
} from "../apps/mobile/src/platform/files/native-jobs";
import { createNativeSourceUpload } from "../apps/mobile/src/platform/files/native-upload";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceName = "00000000-0000-4000-8000-000000000001";
const metadata = () => ({
  sourceName,
  byteLength: 100_000_000,
  contentHash: "a".repeat(64),
  revision: 1,
  signal: new AbortController().signal,
});
const path = "/api/v2/me/lawyer/assets/asset_a/content";
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error("SYNTHETIC_UPLOAD_DID_NOT_ADVANCE");
}
async function fixture(
  options: {
    noUpload?: boolean;
    mime?: string;
    text?: string;
    badHash?: boolean;
    status?: number;
  } = {},
) {
  const scope = createSessionScope(),
    stored = new Map<string, string>(),
    temporary = new Map<string, Uint8Array>(),
    owned = new Map<DownloadDiskFile, Uint8Array>(),
    requests: NativeDiskUploadRequest[] = [],
    events: string[] = [];
  let responseWait: Promise<void> | undefined, hashWait: Promise<void> | undefined;
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => stored.get(key) ?? null,
      setItemAsync: async (key, value) => {
        stored.set(key, value);
      },
    },
    manageStorage: (value) => value,
    codec: {
      header: (value) => (value ? String((JSON.parse(value) as { cookie: string }).cookie) : ""),
      merge: (cookie) => JSON.stringify({ cookie }),
    },
  });
  await credentials.capture().accept("fixture-session=owner");
  const cache = createPrivateDownloads({
    initialize() {},
    create() {
      throw new Error("JS_SOURCE_BYTES_MUST_NOT_RUN");
    },
    async adopt(id) {
      const bytes = temporary.get(id);
      if (!bytes) throw new Error("NO_NATIVE_FILE");
      temporary.delete(id);
      events.push("adopt");
      const file: DownloadDiskFile = {
        size: () => owned.get(file)?.length ?? -1,
        write: async () => {
          throw new Error("NO_JS_WRITE");
        },
        finish() {},
        fingerprint: async () => {
          events.push("hash");
          await hashWait;
          return options.badHash ? "b".repeat(64) : sha(bytes);
        },
        open() {
          throw new Error("JSON_TEXT_ONLY");
        },
        text: async () => new TextDecoder().decode(bytes),
        remove() {
          events.push("remove");
          owned.delete(file);
        },
        present: async () => {},
      };
      owned.set(file, bytes);
      return file;
    },
  });
  const jobs = createNativeDiskJobs({
    reserve: () => crypto.randomUUID(),
    download: async () => {
      throw new Error("NO_DOWNLOAD");
    },
    ...(options.noUpload
      ? {}
      : {
          upload: async (id: string, request: NativeDiskUploadRequest) => {
            requests.push(request);
            events.push("upload");
            await responseWait;
            const status = options.status ?? 200,
              success = status >= 200 && status < 300;
            const bytes = new TextEncoder().encode(
              options.text ?? '{"id":"asset_a","status":"uploaded","revision":2}',
            );
            if (success) temporary.set(id, bytes);
            return {
              status,
              headers: {
                "content-type": options.mime ?? "application/json; charset=utf-8",
                "set-cookie": "fixture-session=renewed",
              },
              size: success ? bytes.length : 0,
              sha256: success ? sha(bytes) : "",
              fileId: success ? id : "",
              body: success ? "" : '{"error":{"code":"CONFLICT","message":"合成"}}',
              maxCopyBytes: success ? bytes.length : 0,
            };
          },
        }),
    cancel: () => {
      events.push("cancel");
    },
    release: async (id) => {
      events.push("release");
      temporary.delete(id);
    },
    clear: async () => {
      temporary.clear();
    },
  });
  const upload = createNativeSourceUpload({
    origin: "https://preview.baro.site",
    ownerId: "owner_a",
    scope,
    signal: scope.signal(),
    frame: credentials.capture(),
    jobs: () => jobs,
    ready: async () => {
      events.push("ready");
    },
    cache,
  });
  return {
    upload,
    requests,
    events,
    owned,
    temporary,
    scope,
    credentials,
    jobs,
    wait: (value: Promise<void>) => {
      responseWait = value;
    },
    waitHash: (value: Promise<void>) => {
      hashWait = value;
    },
  };
}
test("100MB-sized synthetic source passes only immutable metadata, captured cookie/Origin/owner/revision to native; bounded JSON is moved, independently hashed and removed", async () => {
  const f = await fixture();
  expect(await f.upload(path, metadata())).toEqual({
    id: "asset_a",
    status: "uploaded",
    revision: 2,
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]).toMatchObject({
    url: `https://preview.baro.site${path}`,
    method: "PUT",
    maximum: 65536,
    sourceName,
    byteLength: 100_000_000,
    headers: {
      cookie: "fixture-session=owner",
      origin: "https://preview.baro.site",
      "x-baro-expected-owner": "owner_a",
      "content-type": "application/octet-stream",
      "if-match": "1",
    },
  });
  expect(f.requests[0]).not.toHaveProperty("body");
  expect(f.events).toEqual(["ready", "upload", "adopt", "hash", "release", "remove"]);
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=renewed");
  expect(f.temporary.size + f.owned.size).toBe(0);
});
test("missing native upload capability fails before upload without a JS stream fallback", async () => {
  const f = await fixture({ noUpload: true });
  await expect(f.upload(path, metadata())).rejects.toMatchObject({
    code: "UNAVAILABLE",
    message: expect.stringContaining("최신 개발 앱"),
  });
  expect(f.requests).toHaveLength(0);
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=owner");
});
test("foreign, query, fragment, malformed and wrong resource paths never reach native IO", async () => {
  const f = await fixture();
  for (const invalid of [
    `https://evil.invalid${path}`,
    `${path}?key=x`,
    `${path}#x`,
    "/api/v2/cases/foreign/content",
    "http://[",
  ])
    await expect(f.upload(invalid, metadata())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.requests).toHaveLength(0);
});
test("wrong MIME, malformed JSON, oversized JSON and bad native readback hash cannot become an upload ACK", async () => {
  for (const options of [
    { mime: "text/html" },
    { text: "{" },
    { text: "x".repeat(65537) },
    { badHash: true },
  ]) {
    const f = await fixture(options);
    await expect(f.upload(path, metadata())).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.owned.size + f.temporary.size).toBe(0);
    expect(f.events).toContain("release");
  }
});
test("a bounded server conflict stays a conflict and does not adopt an error body as a file", async () => {
  const f = await fixture({ status: 409 });
  await expect(f.upload(path, metadata())).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.events).not.toContain("adopt");
  expect(f.events).toContain("release");
});
test("scope changes during native IO cancel/release and cannot accept late cookie or JSON", async () => {
  const f = await fixture(),
    gate = deferred();
  f.wait(gate.promise);
  const result = f.upload(path, metadata()).catch((error: unknown) => error);
  await until(() => !!f.requests.length);
  f.scope.invalidate();
  gate.resolve();
  expect(await result).toMatchObject({ code: "UNAVAILABLE" });
  expect(f.events).toContain("cancel");
  expect(f.events).toContain("release");
  expect(f.events).not.toContain("adopt");
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=owner");
});
test("cancellation while independent JSON readback runs waits for native release and cleans the adopted private file", async () => {
  const f = await fixture(),
    gate = deferred(),
    controller = new AbortController();
  f.waitHash(gate.promise);
  const result = f
    .upload(path, { ...metadata(), signal: controller.signal })
    .catch((error: unknown) => error);
  await until(() => f.events.includes("hash"));
  controller.abort();
  let cleared = false;
  const clearing = f.jobs.clear().then(() => {
    cleared = true;
  });
  await Promise.resolve();
  expect(cleared).toBe(false);
  gate.resolve();
  await clearing;
  expect(await result).toMatchObject({ code: "UNAVAILABLE" });
  expect(f.owned.size + f.temporary.size).toBe(0);
});
