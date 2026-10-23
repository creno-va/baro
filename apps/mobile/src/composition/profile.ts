import {
  ApiError,
  createLawyerAssetsClient,
  createLawyersClient,
  type DomainRequest,
} from "@baro/api-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import type { PrivateDownload } from "../platform/files/download";
import { createNativeFileTransfer } from "../platform/files/native-transfer";
import { createNativeSourceUpload } from "../platform/files/native-upload";
import type { NativeUploadSource } from "../platform/files/upload-reader";
import { getMobileApi } from "./api";
import { getCaseOperationStorage } from "./cases";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import {
  getNativeDiskJobs,
  getNativeDownloads,
  getNativeUploadSources,
  privateFilesReady,
} from "./files";

export function createNativeProfile(signal: AbortSignal, ownerId: string) {
  const { scope, credentials } = getMobileCredentials(),
    generation = scope.snapshot();
  const combined = AbortSignal.any([signal, scope.signal()]);
  const ensure = () => {
    combined.throwIfAborted();
    if (!scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
  };
  const request: DomainRequest = (path, options = {}) => {
    ensure();
    return getMobileApi().request({
      ...options,
      path,
      expectedOwner: ownerId,
      signal: options.signal ? AbortSignal.any([combined, options.signal]) : combined,
      ...(options.headers?.["idempotency-key"] ? { key: options.headers["idempotency-key"] } : {}),
    });
  };
  const config = readMobileConfig(),
    frame = credentials.capture(),
    cache = getNativeDownloads();
  const ports = {
    origin: config.apiBaseUrl,
    ownerId,
    scope,
    signal: combined,
    frame,
    jobs: getNativeDiskJobs,
    ready: privateFilesReady,
    cache,
  };
  const upload = createNativeSourceUpload(ports),
    download = createNativeFileTransfer({ ...ports, maximum: 100_000_000 });
  return {
    profile: createLawyersClient({ scope, request }),
    assets: createLawyerAssetsClient<NativeUploadSource, PrivateDownload>({
      scope,
      signal: combined,
      request,
      newKey: randomUUID,
      persistence: "required",
      storage: getCaseOperationStorage(),
      fingerprintText: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
      open: async (source, abort) => {
        await privateFilesReady();
        ensure();
        if (!getNativeDiskJobs().supportsUpload)
          throw new ApiError(
            "UNAVAILABLE",
            "자료 업로드 기능을 사용하려면 최신 개발 앱을 설치해 주세요.",
          );
        const reader = await getNativeUploadSources().openUpload(source, abort);
        return {
          fingerprint: reader.fingerprint,
          close: reader.close,
          body: async () => {
            throw new ApiError("UNAVAILABLE", "최신 개발 앱의 native 업로드가 필요해요.");
          },
        };
      },
      uploadContent: async () => {
        throw new ApiError("UNAVAILABLE", "최신 개발 앱의 native 업로드가 필요해요.");
      },
      uploadContentFromSource: (path, input) =>
        getNativeUploadSources().withNativeSource(input.source, input.signal, (context) =>
          upload(path, { ...input, sourceName: context.sourceName, signal: context.signal }),
        ),
      download: (path, options) => download(path, options),
    }),
  };
}
