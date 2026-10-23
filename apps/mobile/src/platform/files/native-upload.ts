import { ApiError, isApiPath, type ReportArtifact, responseError } from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import type { NativeCredentialFrame } from "../auth/credentials";
import type { createPrivateDownloads, PrivateDownload } from "./download";
import type { createNativeDiskJobs } from "./native-jobs";

const failed = () =>
  new ApiError(
    "UNAVAILABLE",
    "자료 업로드를 확인하지 못했어요. 같은 파일을 다시 선택해 상태를 확인해 주세요.",
    true,
  );
/** Small JSON response only; source bytes remain in the native immutable file lease. */
export function createNativeSourceUpload(dependencies: {
  origin: string;
  ownerId: string;
  scope: SessionScope;
  signal: AbortSignal;
  frame: NativeCredentialFrame;
  jobs(): ReturnType<typeof createNativeDiskJobs>;
  ready(): Promise<void>;
  cache: Pick<ReturnType<typeof createPrivateDownloads>, "adopt">;
}) {
  const generation = dependencies.scope.snapshot(),
    signal = AbortSignal.any([dependencies.signal, dependencies.scope.signal()]);
  return async (
    path: string,
    input: {
      sourceName: string;
      byteLength: number;
      contentHash: string;
      revision: number;
      signal: AbortSignal;
    },
  ): Promise<unknown> => {
    const abort = AbortSignal.any([signal, input.signal]);
    const ensure = () => {
      if (!dependencies.scope.isCurrent(generation))
        throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요.");
      abort.throwIfAborted();
    };
    // Copy expected metadata before credential/storage awaits.
    const upload = { ...input };
    let artifact: ReportArtifact<PrivateDownload> | undefined;
    try {
      ensure();
      const url = new URL(path, dependencies.origin);
      if (
        !isApiPath(path) ||
        url.origin !== dependencies.origin ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        !/^\/api\/v2\/me\/lawyer\/assets\/[A-Za-z0-9_-]{1,128}\/content$/.test(url.pathname) ||
        !Number.isSafeInteger(upload.revision) ||
        upload.revision <= 0
      )
        throw failed();
      await dependencies.ready();
      ensure();
      const jobs = dependencies.jobs();
      if (!jobs.supportsUpload)
        throw new ApiError(
          "UNAVAILABLE",
          "자료 업로드 기능을 사용하려면 최신 개발 앱을 설치해 주세요.",
        );
      const cookie = await dependencies.frame.cookie();
      ensure();
      return await jobs.runUpload(
        {
          url: url.href,
          origin: dependencies.origin,
          method: "PUT",
          maximum: 65536,
          sourceName: upload.sourceName,
          byteLength: upload.byteLength,
          contentHash: upload.contentHash,
          headers: {
            origin: dependencies.origin,
            [EXPECTED_OWNER_HEADER]: encodeURIComponent(dependencies.ownerId),
            "content-type": "application/octet-stream",
            "if-match": String(upload.revision),
            ...(cookie ? { cookie } : {}),
          },
        },
        abort,
        async (result, context) => {
          context.ensure();
          ensure();
          const headers = new Headers(result.headers);
          await dependencies.frame.accept(headers.get("set-cookie"));
          context.ensure();
          ensure();
          headers.delete("set-cookie");
          if (result.status < 200 || result.status >= 300)
            throw await responseError(
              new Response(result.body, { status: result.status, headers }),
            );
          const mimeType = (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
          if (mimeType !== "application/json") throw failed();
          artifact = await dependencies.cache.adopt(
            {
              fileId: result.fileId,
              size: result.size,
              sha256: result.sha256,
              mimeType,
              disposition: "",
            },
            context.signal,
            65536,
          );
          context.ensure();
          ensure();
          const text = await artifact.text();
          context.ensure();
          ensure();
          if (new TextEncoder().encode(text).length > 65536) throw failed();
          return JSON.parse(text) as unknown;
        },
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw failed();
    } finally {
      if (artifact) await Promise.resolve(artifact.discard()).catch(() => {});
    }
  };
}
