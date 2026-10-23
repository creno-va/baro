import { ApiError } from "@baro/api-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { getCaseOperationStorage } from "../src/composition/cases";
import { readMobileConfig } from "../src/composition/config";
import { getMobileCredentials } from "../src/composition/credentials";
import { createExpoUploadSources } from "../src/platform/files/documents";
import { createExpoDownloads } from "../src/platform/files/expo-download";
import { createNativeDiskJobs, type NativeDiskPort } from "../src/platform/files/native-jobs";
import { requireNativeDiskPort } from "../src/platform/files/native-module";
import { createNativeFileTransfer } from "../src/platform/files/native-transfer";
import { createNativeSourceUpload } from "../src/platform/files/native-upload";
import {
  DOWNLOAD_BYTES,
  OWNER_COOKIE,
  PEER_COOKIE,
  PROBE_OWNER,
  probeResultSchema,
  type RuntimeConfig,
  runtimeConfigSchema,
  UPLOAD_BYTES,
} from "./protocol";

export class ProbeFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const requireValue = (condition: unknown, code: string) => {
  if (!condition) throw new ProbeFailure(code);
};
export function probeConfig(): RuntimeConfig {
  const local = readMobileConfig();
  requireValue(local.environment === "local", "PROBE_LOCAL_REQUIRED");
  return runtimeConfigSchema.parse({
    version: 1,
    origin: local.apiBaseUrl,
    sourceSha: process.env.EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA,
    nonce: process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE,
  });
}
export async function report(config: RuntimeConfig, path: string, body?: unknown) {
  const response = await fetch(`${config.origin}/probe/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-baro-probe-run": config.nonce,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  requireValue(response.ok, "PROBE_CONTROL_REJECTED");
  return (await response.json()) as {
    delayedStarted: boolean;
    cancelUploadStarted: boolean;
    cancelUploadBytes: number;
  };
}
async function until(config: RuntimeConfig, key: "delayedStarted" | "cancelUploadStarted") {
  for (let i = 0; i < 150; i++) {
    const state = await report(config, "control");
    if (state[key]) return state;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new ProbeFailure("PROBE_NATIVE_REQUEST_NOT_OBSERVED");
}
function countFiles(name: string) {
  const directory = new Directory(Paths.cache, name);
  return directory.exists ? directory.list().length : 0;
}
async function writeSource() {
  const file = new File(Paths.cache, `baro-runtime-input-${randomUUID()}.pdf`);
  file.create();
  const handle = file.open(FileMode.WriteOnly),
    chunk = new Uint8Array(65536).fill(97);
  try {
    for (let offset = 0; offset < UPLOAD_BYTES; offset += chunk.length)
      await handle.writeBytes(chunk.subarray(0, Math.min(chunk.length, UPLOAD_BYTES - offset)));
  } finally {
    handle.close();
  }
  requireValue(file.size === UPLOAD_BYTES, "PROBE_SOURCE_SIZE");
  return file;
}
/** Runs only via an isolated manual local entry; production router never imports this module. */
export async function runNativeProbe(config: RuntimeConfig, step: (name: string) => void) {
  requireValue(Platform.OS === "android" || Platform.OS === "ios", "PROBE_NATIVE_OS_REQUIRED");
  const native = requireNativeDiskPort();
  let nativeCalls = 0,
    nativeMaxCopyBytes = 0;
  const observe = (value: unknown) => {
    if (value && typeof value === "object" && "maxCopyBytes" in value) {
      const count = value.maxCopyBytes;
      requireValue(
        typeof count === "number" && count >= 0 && count <= 65536,
        "PROBE_NATIVE_COPY_BOUND",
      );
      nativeMaxCopyBytes = Math.max(nativeMaxCopyBytes, Number(count));
    }
    return value;
  };
  const actual: NativeDiskPort = {
    reserve: () => native.reserve(),
    cancel: (id) => native.cancel(id),
    release: (id) => native.release(id),
    clear: () => native.clear(),
    download: async (id, request) => {
      nativeCalls++;
      return observe(await native.download(id, request));
    },
    upload: async (id, request) => {
      nativeCalls++;
      requireValue(!!native.upload, "PROBE_UPLOAD_MODULE_REQUIRED");
      return observe(await native.upload?.(id, request));
    },
  };
  const jobs = createNativeDiskJobs(actual),
    cache = createExpoDownloads("baro_local_runtime_downloads", randomUUID);
  const { scope, credentials } = getMobileCredentials();
  const storage = getCaseOperationStorage(),
    sentinelKey = `baro-lawyer-upload-v2:${await digestStringAsync(CryptoDigestAlgorithm.SHA256, config.nonce)}`,
    sentinel = JSON.stringify({ key: randomUUID(), expectedRevision: 1 });
  let input: File | undefined;
  const sources = createExpoUploadSources({
    namespace: "baro_local_private_uploads",
    newId: randomUUID,
    pick: async () => {
      requireValue(!!input?.exists, "PROBE_INPUT_MISSING");
      return {
        canceled: false,
        assets: [
          {
            uri: input?.uri ?? "",
            name: "synthetic-runtime.pdf",
            size: UPLOAD_BYTES,
            mimeType: "application/pdf",
            lastModified: 0,
          },
        ],
      };
    },
  });
  const ownerCookie = async () => {
    await credentials.capture().accept(`${OWNER_COOKIE}; Path=/; HttpOnly; SameSite=Lax`);
    requireValue(
      (await credentials.capture().cookie()) === OWNER_COOKIE,
      "PROBE_SECURE_STORE_READBACK",
    );
  };
  const ports = () => ({
    origin: config.origin,
    ownerId: PROBE_OWNER,
    scope,
    signal: scope.signal(),
    frame: credentials.capture(),
    jobs: () => jobs,
    cache,
    ready: async () => {},
  });
  const path = (id: string) => `/api/v2/cases/probe_case/files/${id}/content`;
  try {
    step("native-ready");
    await jobs.clear();
    await sources.clear();
    await cache.clear();
    await credentials.reset();
    await ownerCookie();
    await storage.setItem(sentinelKey, sentinel);
    requireValue((await storage.getItem(sentinelKey)) === sentinel, "PROBE_RECOVERY_WRITE");
    step("upload-100mb");
    input = await writeSource();
    const selected = await sources.select(scope.signal());
    requireValue(selected, "PROBE_SOURCE_SELECTION");
    if (!selected) throw new ProbeFailure("PROBE_SOURCE_SELECTION");
    const reader = await sources.openUpload(selected, scope.signal());
    const sha = await reader.fingerprint();
    let uploadResult: unknown;
    try {
      const upload = createNativeSourceUpload(ports());
      uploadResult = await sources.withNativeSource(selected, scope.signal(), (lease) =>
        upload("/api/v2/me/lawyer/assets/upload/content", {
          sourceName: lease.sourceName,
          signal: lease.signal,
          byteLength: selected.size,
          contentHash: sha,
          revision: 1,
        }),
      );
    } finally {
      await reader.close();
      await sources.release(selected);
    }
    requireValue(
      uploadResult &&
        typeof uploadResult === "object" &&
        "sha256" in uploadResult &&
        uploadResult.sha256 === sha &&
        "bytes" in uploadResult &&
        uploadResult.bytes === UPLOAD_BYTES,
      "PROBE_UPLOAD_RECEIPT",
    );
    step("download-1gb");
    const download = createNativeFileTransfer({ ...ports(), maximum: DOWNLOAD_BYTES });
    const artifact = await download(path("download"));
    const downloadSha = artifact.value.sha256;
    requireValue(artifact.size === DOWNLOAD_BYTES, "PROBE_DOWNLOAD_SIZE");
    for (const bytes of [
      await artifact.read(0, 32),
      await artifact.read(DOWNLOAD_BYTES - 32, DOWNLOAD_BYTES),
    ])
      requireValue(
        bytes.length === 32 && bytes.every((value) => value === 97),
        "PROBE_SDK_READBACK",
      );
    await artifact.discard();
    let unauthorizedRejected = false;
    try {
      await download(path("unauthorized"));
    } catch (error) {
      unauthorizedRejected = error instanceof ApiError && error.code === "UNAUTHENTICATED";
    }
    requireValue(unauthorizedRejected, "PROBE_HTTP_ERROR");
    const before = nativeCalls;
    let crossOriginRejected = false;
    try {
      await download("https://outside.invalid/api/v2/no-content");
    } catch {
      crossOriginRejected = nativeCalls === before;
    }
    requireValue(crossOriginRejected, "PROBE_ORIGIN_FENCE");
    step("owner-cancel");
    const old = download(path("delayed")).then(
      () => false,
      () => true,
    );
    await until(config, "delayedStarted");
    scope.invalidate();
    await credentials.capture().accept(`${PEER_COOKIE}; Path=/; HttpOnly; SameSite=Lax`);
    requireValue(await old, "PROBE_OWNER_CHANGE");
    await jobs.clear();
    await report(config, "release", {});
    const peerCookiePreserved = (await credentials.capture().cookie()) === PEER_COOKIE;
    requireValue(peerCookiePreserved, "PROBE_PEER_COOKIE_CHANGED");
    await ownerCookie();
    step("source-clear-cancel");
    input = await writeSource();
    const cancelling = await sources.select(scope.signal());
    if (!cancelling) throw new ProbeFailure("PROBE_SOURCE_SELECTION");
    const cancelReader = await sources.openUpload(cancelling, scope.signal()),
      cancelSha = await cancelReader.fingerprint(),
      upload = createNativeSourceUpload(ports());
    const cancelled = sources
      .withNativeSource(cancelling, scope.signal(), (lease) =>
        upload("/api/v2/me/lawyer/assets/cancel/content", {
          sourceName: lease.sourceName,
          signal: lease.signal,
          byteLength: UPLOAD_BYTES,
          contentHash: cancelSha,
          revision: 1,
        }),
      )
      .then(
        () => false,
        () => true,
      );
    const control = await until(config, "cancelUploadStarted");
    await sources.clear();
    requireValue(await cancelled, "PROBE_SOURCE_CLEAR_DID_NOT_CANCEL");
    await cancelReader.close();
    await report(config, "release", {});
    step("cleanup");
    await jobs.clear();
    await sources.clear();
    await cache.clear();
    await credentials.reset();
    const unresolvedKeyPreserved = (await storage.getItem(sentinelKey)) === sentinel;
    requireValue(unresolvedKeyPreserved, "PROBE_RECOVERY_KEY_LOST");
    await storage.removeItem(sentinelKey);
    requireValue((await storage.getItem(sentinelKey)) === null, "PROBE_SENTINEL_CLEANUP");
    const result = probeResultSchema.parse({
      version: 1,
      sourceSha: config.sourceSha,
      platform: Platform.OS,
      upload: { bytes: UPLOAD_BYTES, sha256: sha },
      download: { bytes: DOWNLOAD_BYTES, sha256: downloadSha },
      nativeCalls,
      nativeMaxCopyBytes,
      sdkSourceReadback: true,
      sdkDownloadReadback: true,
      secureStoreReadback: true,
      unresolvedKeyPreserved,
      cancelUploadBytesReceived: control.cancelUploadBytes,
      unauthorizedRejected,
      crossOriginRejected,
      ownerChangeRejected: true,
      peerCookiePreserved,
      sourceClearRejectedActiveUpload: true,
      sourceFilesRemaining: countFiles("baro_local_private_uploads"),
      downloadFilesRemaining: countFiles("baro_local_runtime_downloads"),
      nativeFilesRemaining: countFiles("baro_native_transfers"),
      documentPickerVerified: false,
      oauthVerified: false,
      remoteApiVerified: false,
      physicalDeviceVerified: false,
      storeSigned: false,
      deployed: false,
    });
    await report(config, "result", result);
    step("passed");
    return result;
  } finally {
    await report(config, "release", {}).catch(() => {});
    await Promise.allSettled([jobs.clear(), sources.clear(), cache.clear(), credentials.reset()]);
    await Promise.resolve(storage.removeItem(sentinelKey)).catch(() => {});
    if (input?.exists) input.delete();
  }
}
