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
  type NativeDiskRequest,
  type NativeDiskResult,
} from "../apps/mobile/src/platform/files/native-jobs";
import { createNativeFileTransfer } from "../apps/mobile/src/platform/files/native-transfer";
import { checkReportResponse } from "../apps/mobile/src/platform/reports/http";

const bytes = new Uint8Array([37, 80, 68, 70, 45]);
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function until(ready: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (ready()) return;
    await tick();
  }
  throw new Error("SYNTHETIC_TRANSFER_DID_NOT_ADVANCE");
}
async function fixture() {
  const scope = createSessionScope(),
    credentialsStore = new Map<string, string>(),
    temporary = new Map<string, Uint8Array>(),
    owned = new Map<DownloadDiskFile, Uint8Array>();
  const events: string[] = [],
    requests: NativeDiskRequest[] = [];
  let responseDelay: Promise<void> | undefined,
    digestDelay: Promise<void> | undefined,
    badHash = false,
    status = 200,
    errorBody = "",
    opens = 0,
    digests = 0;
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => credentialsStore.get(key) ?? null,
      setItemAsync: async (key, value) => {
        credentialsStore.set(key, value);
      },
    },
    manageStorage: (value) => value,
    codec: {
      header: (value) => (value ? ((JSON.parse(value) as { cookie?: string }).cookie ?? "") : ""),
      merge: (cookie) => JSON.stringify({ cookie }),
    },
  });
  await credentials.capture().accept("fixture-session=owner-a");
  const cache = createPrivateDownloads({
    initialize() {},
    create() {
      throw new Error("JS_BYTE_DOWNLOAD_MUST_NOT_RUN");
    },
    async adopt(id) {
      events.push("adopt");
      const value = temporary.get(id);
      if (!value) throw new Error("MISSING_NATIVE_FILE");
      temporary.delete(id);
      const file: DownloadDiskFile = {
        size: () => owned.get(file)?.byteLength ?? -1,
        write: async () => {
          throw new Error("NO_JS_BODY_WRITE");
        },
        finish() {},
        fingerprint: async () => {
          digests++;
          events.push("digest-start");
          await digestDelay;
          events.push("digest-end");
          return badHash ? "f".repeat(64) : hash(owned.get(file) ?? new Uint8Array());
        },
        open() {
          opens++;
          let offset = 0;
          return {
            get size() {
              return owned.get(file)?.byteLength ?? null;
            },
            get offset() {
              return offset;
            },
            set offset(value) {
              offset = value ?? 0;
            },
            async readBytes(length) {
              const chunk = owned.get(file)?.slice(offset, offset + length) ?? new Uint8Array();
              offset += chunk.length;
              return chunk;
            },
            close() {},
          };
        },
        text: async () => new TextDecoder().decode(owned.get(file)),
        remove() {
          events.push("remove");
          owned.delete(file);
        },
        present: async () => {},
      };
      owned.set(file, value);
      return file;
    },
  });
  const jobs = createNativeDiskJobs({
    reserve: () => crypto.randomUUID(),
    download: async (id, request): Promise<NativeDiskResult> => {
      requests.push(request);
      events.push("download");
      await responseDelay;
      if (status >= 200 && status < 300) temporary.set(id, bytes);
      return {
        status,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(bytes.length),
          "set-cookie": "fixture-session=owner-a-renewed",
        },
        size: status >= 200 && status < 300 ? bytes.length : 0,
        sha256: status >= 200 && status < 300 ? hash(bytes) : "",
        fileId: status >= 200 && status < 300 ? id : "",
        body: errorBody,
        maxCopyBytes: bytes.length,
      };
    },
    cancel: () => {
      events.push("cancel");
    },
    release: async (id) => {
      events.push("release");
      temporary.delete(id);
    },
    clear: async () => {
      events.push("native-clear");
      temporary.clear();
    },
  });
  const download = createNativeFileTransfer({
    origin: "https://preview.baro.site",
    ownerId: "owner_a",
    scope,
    signal: scope.signal(),
    frame: credentials.capture(),
    jobs: () => jobs,
    ready: async () => {},
    cache,
    maximum: 1000000000,
    checkResponse: checkReportResponse,
  });
  return {
    download,
    scope,
    credentials,
    jobs,
    cache,
    temporary,
    owned,
    events,
    requests,
    opens: () => opens,
    digests: () => digests,
    delay: (value: Promise<void>) => {
      responseDelay = value;
    },
    digestDelay: (value: Promise<void>) => {
      digestDelay = value;
    },
    badHash: () => {
      badHash = true;
    },
    error: (code: number, body: string) => {
      status = code;
      errorBody = body;
    },
  };
}

test("captured cookie/Origin/owner and exact durable POST body/key reach native IO; success moves and independently hashes without a JS body/read", async () => {
  const f = await fixture(),
    body = { expectedRevision: 7, fileIds: ["file_a"] };
  const saved = await f.download("/api/v2/reports/report_a/exports", {
    method: "POST",
    body,
    headers: {
      "idempotency-key": "opaque-recovery-key",
      cookie: "injected",
      authorization: "injected",
      origin: "https://evil.invalid",
    },
  });
  expect(f.requests[0]).toMatchObject({
    url: "https://preview.baro.site/api/v2/reports/report_a/exports",
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      cookie: "fixture-session=owner-a",
      origin: "https://preview.baro.site",
      "x-baro-expected-owner": "owner_a",
      "idempotency-key": "opaque-recovery-key",
      "content-type": "application/json",
    },
  });
  expect(f.requests[0]?.headers.authorization).toBeUndefined();
  expect(f.opens()).toBe(0);
  expect(f.digests()).toBe(1);
  expect(f.temporary.size).toBe(0);
  expect(f.owned.size).toBe(1);
  expect(saved.value).toEqual({ size: 5, mimeType: "application/pdf", sha256: hash(bytes) });
  expect(Object.keys(saved.value).sort()).toEqual(["mimeType", "sha256", "size"]);
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=owner-a-renewed");
  expect(await saved.read(0, 5)).toEqual(bytes);
  expect(f.opens()).toBe(1);
  await saved.discard();
  expect(f.owned.size).toBe(0);
});

test("same-length corrupted adoption is rejected and both native lease and owned file are released", async () => {
  const f = await fixture();
  f.badHash();
  await expect(f.download("/api/v2/reports/report_a/pdf")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.temporary.size).toBe(0);
  expect(f.owned.size).toBe(0);
  expect(f.events).toContain("release");
  expect(f.events).toContain("remove");
});

test("reset waits for independent native readback IO before cleanup and cannot publish an aborted artifact", async () => {
  const f = await fixture(),
    gate = deferred<void>();
  f.digestDelay(gate.promise);
  const task = f.download("/api/v2/reports/report_a/pdf");
  const outcome = task.catch((error: unknown) => error);
  await until(() => !!f.digests());
  let cleared = false;
  const clearing = f.jobs.clear().then(() => {
    cleared = true;
  });
  await tick();
  expect(cleared).toBe(false);
  gate.resolve();
  await clearing;
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.owned.size).toBe(0);
  expect(f.temporary.size).toBe(0);
  expect(f.events.indexOf("digest-end")).toBeLessThan(f.events.indexOf("remove"));
  expect(f.events.indexOf("release")).toBeLessThan(f.events.indexOf("native-clear"));
});

test("a late native response after account replacement cannot refresh the new jar or adopt old bytes", async () => {
  const f = await fixture(),
    gate = deferred<void>();
  f.delay(gate.promise);
  const outcome = f.download("/api/v2/reports/report_a/pdf").catch((error: unknown) => error);
  await until(() => !!f.requests.length);
  f.scope.invalidate();
  await f.credentials.reset();
  await f.credentials.capture().accept("fixture-session=peer");
  gate.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=peer");
  expect(f.owned.size).toBe(0);
  expect(f.temporary.size).toBe(0);
  expect(f.events).not.toContain("adopt");
});

test("bounded HTTP errors retain detailed report conflict, accept only current cookie and never become a file", async () => {
  const f = await fixture();
  f.error(409, JSON.stringify({ error: { code: "STALE_REVISION" } }));
  await expect(
    f.download("/api/v2/reports/report_a/exports", { method: "POST", body: {} }),
  ).rejects.toMatchObject({ reason: "STALE_REVISION", code: "CONFLICT" });
  expect(await f.credentials.capture().cookie()).toBe("fixture-session=owner-a-renewed");
  expect(f.owned.size).toBe(0);
  expect(f.digests()).toBe(0);
  expect(f.events).toContain("release");
});

test("unsafe destination/query/verb never dispatches native requests or moves private files", async () => {
  const f = await fixture();
  for (const path of [
    "https://evil.invalid/api/file",
    "//evil.invalid/api/file",
    "/policies/privacy",
    "/api/file?token=private",
    "/api/file#fragment",
  ])
    await expect(f.download(path)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(f.download("/api/v2/reports/report_a/pdf", { method: "PUT" })).rejects.toMatchObject(
    { code: "UNAVAILABLE" },
  );
  expect(f.requests).toEqual([]);
  expect(f.events).toEqual([]);
});
