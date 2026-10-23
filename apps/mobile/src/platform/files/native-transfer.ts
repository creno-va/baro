import {
  ApiError,
  type DomainRequestInit,
  isApiPath,
  type ReportArtifact,
  responseError,
} from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";
import { EXPECTED_OWNER_HEADER } from "@baro/contracts/session";
import type { NativeCredentialFrame } from "../auth/credentials";
import type { createPrivateDownloads, PrivateDownload } from "./download";
import type { createNativeDiskJobs } from "./native-jobs";

const denied = () =>
  new ApiError("UNAVAILABLE", "안전한 파일 연결을 확인하지 못했어요. 다시 확인해 주세요.", true);
/** Captured one-writer credential frame. Successful bytes never enter an HTTP Response/JS queue. */
export function createNativeFileTransfer(dependencies: {
  origin: string;
  ownerId: string;
  scope: SessionScope;
  signal: AbortSignal;
  frame: NativeCredentialFrame;
  jobs(): ReturnType<typeof createNativeDiskJobs>;
  ready(): Promise<void>;
  cache: Pick<ReturnType<typeof createPrivateDownloads>, "adopt">;
  maximum: number;
  checkResponse?(response: Response): Promise<void>;
}) {
  const generation = dependencies.scope.snapshot(),
    signal = AbortSignal.any([dependencies.signal, dependencies.scope.signal()]);
  const ensure = (abort: AbortSignal) => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    abort.throwIfAborted();
  };
  return async (
    path: string,
    options: DomainRequestInit = {},
  ): Promise<ReportArtifact<PrivateDownload>> => {
    const combined = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
    let artifact: ReportArtifact<PrivateDownload> | undefined;
    try {
      ensure(combined);
      const url = new URL(path, dependencies.origin),
        method = options.method ?? "GET";
      if (
        !isApiPath(path) ||
        url.origin !== dependencies.origin ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        !["GET", "POST"].includes(method)
      )
        throw denied();
      const headers = new Headers(options.headers),
        body = options.body === undefined ? undefined : JSON.stringify(options.body);
      headers.delete("cookie");
      headers.delete("authorization");
      headers.set("origin", dependencies.origin);
      headers.set(EXPECTED_OWNER_HEADER, encodeURIComponent(dependencies.ownerId));
      if (body !== undefined) headers.set("content-type", "application/json");
      await dependencies.ready();
      ensure(combined);
      const jobs = dependencies.jobs(),
        cookie = await dependencies.frame.cookie();
      ensure(combined);
      if (cookie) headers.set("cookie", cookie);
      artifact = await jobs.run(
        {
          url: url.href,
          origin: dependencies.origin,
          method: method as "GET" | "POST",
          headers: Object.fromEntries(headers),
          ...(body === undefined ? {} : { body }),
          maximum: dependencies.maximum,
        },
        combined,
        async (result, context) => {
          context.ensure();
          ensure(combined);
          const reply = new Headers(result.headers);
          await dependencies.frame.accept(reply.get("set-cookie"));
          context.ensure();
          ensure(combined);
          reply.delete("set-cookie");
          if (result.status < 200 || result.status >= 300) {
            const errorResponse = new Response(result.body, {
              status: result.status,
              headers: reply,
            });
            if (dependencies.checkResponse) await dependencies.checkResponse(errorResponse);
            else throw await responseError(errorResponse);
            throw denied();
          }
          // Do not construct a success Response, nor an ArrayBuffer/base64/stream of its body.
          const mimeType =
            (reply.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
          const saved = await dependencies.cache.adopt(
            {
              fileId: result.fileId,
              size: result.size,
              sha256: result.sha256,
              mimeType,
              disposition: reply.get("content-disposition") ?? "",
            },
            context.signal,
            dependencies.maximum,
          );
          try {
            context.ensure();
            ensure(combined);
            return saved;
          } catch (error) {
            await Promise.resolve(saved.discard()).catch(() => {});
            throw error;
          }
        },
      );
      ensure(combined);
      return artifact;
    } catch (error) {
      if (artifact) await Promise.resolve(artifact.discard()).catch(() => {});
      if (error instanceof ApiError) throw error;
      throw denied();
    }
  };
}
