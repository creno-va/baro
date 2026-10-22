import {
  ApiError,
  createFileMetadataReader,
  createReportsClient,
  type WorkspaceTransport,
} from "@baro/api-client";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import { V2_LIMITS } from "@baro/contracts/v2";
import { fetch as expoFetch } from "expo/fetch";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { createNativeTransport } from "../platform/auth/transport";
import type { PrivateDownload } from "../platform/files/download";
import { checkReportResponse, createReportHttp } from "../platform/reports/http";
import { getCaseOperationStorage } from "./cases";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { createNativeFiles, getNativeDownloads, privateFilesReady } from "./files";

export function createNativeReports(signal: AbortSignal, ownerId: string) {
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
  const reports = createReportsClient<PrivateDownload>({
    scope,
    signal: combined,
    request: createReportHttp(request),
    newKey: randomUUID,
    coalesceWrites: "credential-scope",
    recovery: {
      ownerId,
      storage: getCaseOperationStorage(),
      fingerprint: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    },
    download: async (path, options) => {
      await privateFilesReady();
      ensure();
      const response = await request(path, {
        method: options.method ?? "GET",
        headers: { ...options.headers, "content-type": "application/json" },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: options.signal,
      });
      await checkReportResponse(response);
      ensure();
      const artifact = await getNativeDownloads().receive(
        response,
        combined,
        V2_LIMITS.accountStorageBytes,
      );
      try {
        ensure();
        return artifact;
      } catch (error) {
        await Promise.resolve(artifact.discard()).catch(() => {});
        throw error;
      }
    },
  });
  const listFiles = createFileMetadataReader(request);
  return {
    reports,
    listFiles,
    original: (caseId: string, fileId: string) =>
      createNativeFiles(combined, ownerId, () => {}).original(caseId, fileId),
  };
}
