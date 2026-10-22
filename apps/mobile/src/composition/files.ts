import {
  ApiError,
  createFilesClient,
  type ReportArtifact,
  type WorkspaceTransport,
} from "@baro/api-client";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { V2_LIMITS } from "@baro/contracts/v2";
import { fetch as expoFetch } from "expo/fetch";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { createNativeTransport } from "../platform/auth/transport";
import { createExpoUploadSources } from "../platform/files/documents";
import type { PrivateDownload } from "../platform/files/download";
import { createExpoDownloads } from "../platform/files/expo-download";
import { getCaseOperationStorage } from "./cases";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

let sources: ReturnType<typeof createExpoUploadSources> | undefined;
let downloads: ReturnType<typeof createExpoDownloads> | undefined;
let pendingReset: Promise<void> = Promise.resolve();
let resetFailed = false;
export function getNativeDownloads() {
  if (!downloads)
    downloads = createExpoDownloads(
      `baro_${readMobileConfig().environment}_private_downloads`,
      randomUUID,
    );
  return downloads;
}
export function resetPrivateFiles() {
  pendingReset = pendingReset
    .catch(() => {})
    .then(async () => {
      const results = await Promise.allSettled([
        getNativeUploadSources().clear(),
        getNativeDownloads().clear(),
      ]);
      resetFailed = results.some((result) => result.status === "rejected");
      if (resetFailed)
        throw new ApiError(
          "UNAVAILABLE",
          "기기의 임시 파일을 정리하지 못했어요. 저장 공간과 접근 권한을 확인해 주세요.",
          true,
        );
    });
  return pendingReset;
}
export async function privateFilesReady() {
  if (resetFailed) await resetPrivateFiles();
  let observed: Promise<void>;
  do {
    observed = pendingReset;
    await observed;
  } while (observed !== pendingReset);
}
export function getNativeUploadSources() {
  if (!sources) {
    const config = readMobileConfig();
    sources = createExpoUploadSources({
      namespace: `baro_${config.environment}_private_uploads`,
      newId: randomUUID,
    });
  }
  return sources;
}

export function createNativeFiles(
  signal: AbortSignal,
  ownerId: string,
  onUploadAcknowledged: (id: string) => void,
) {
  const { scope, credentials } = getMobileCredentials(),
    generation = scope.snapshot();
  const combined = AbortSignal.any([signal, scope.signal()]);
  const ensure = () => {
    combined.throwIfAborted();
    if (!scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "계정을 다시 확인해 주세요.");
  };
  const transport = createNativeTransport({
    config: readMobileConfig(),
    credentials,
    frame: credentials.capture(),
    fetch: (url, init) => expoFetch(url, init),
  });
  const request: WorkspaceTransport = async (path, init = {}) => {
    await privateFilesReady();
    ensure();
    const headers = new Headers(init.headers);
    headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(ownerId));
    const response = await transport(path, {
      ...init,
      headers,
      signal: init.signal ? AbortSignal.any([combined, init.signal]) : combined,
    });
    ensure();
    return response;
  };
  const client = createFilesClient({
    scope,
    signal: combined,
    request,
    newKey: randomUUID,
    coalesceWrites: "credential-scope",
    recovery: {
      ownerId,
      storage: getCaseOperationStorage(),
      fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    },
    openUpload: (source: import("../platform/files/documents").NativeUploadSource, abort) =>
      getNativeUploadSources().openUpload(source, abort),
    onUploadAcknowledged,
    download: async (response, abort): Promise<PrivateDownload> => {
      let artifact: ReportArtifact<PrivateDownload> | undefined;
      try {
        artifact = await getNativeDownloads().receive(response, abort, V2_LIMITS.mediaBytes);
        ensure();
        return artifact.value;
      } catch (error) {
        if (artifact) await Promise.resolve(artifact.discard()).catch(() => {});
        throw error;
      }
    },
  });
  return client;
}
