import { ApiError, type HttpTransport } from "@baro/api-client";
import { MOBILE_AUTH_CONTRACT_HEADER } from "@baro/contracts/mobile-auth";
import type { MobileConfig } from "../../../config/environment";
import { withoutSetCookie } from "./transport";

const completionPath = /^\/api\/mobile\/auth\/deletion\/(?:exchange|status|cancel|activity)$/;
const denied = () =>
  new ApiError("UNAVAILABLE", "삭제 결과를 확인할 안전한 서버 연결이 필요해요.", true);
/** Proof-only completion remains independent of every current/native cookie writer and owner generation. */
export function createNativeDeletionTransport(dependencies: {
  config: MobileConfig;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): HttpTransport {
  return async (path, init) => {
    let url: URL;
    try {
      url = new URL(path, dependencies.config.apiBaseUrl);
    } catch {
      throw denied();
    }
    if (
      url.origin !== dependencies.config.apiBaseUrl ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !completionPath.test(url.pathname) ||
      init.method !== "POST"
    )
      throw denied();
    init.signal?.throwIfAborted();
    const incoming = new Headers(init.headers);
    if (
      incoming.get(MOBILE_AUTH_CONTRACT_HEADER) !== "2" ||
      incoming.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw denied();
    const headers = new Headers({
      origin: dependencies.config.apiBaseUrl,
      "content-type": "application/json",
      [MOBILE_AUTH_CONTRACT_HEADER]: "2",
    });
    const response = await dependencies.fetch(url.href, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrer: "",
      referrerPolicy: "no-referrer",
    });
    try {
      if (response.redirected || (response.url && response.url !== url.href)) throw denied();
      init.signal?.throwIfAborted();
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    // Never accept refresh/expiry cookies here, including anonymous 401 and another owner's responses.
    return withoutSetCookie(response);
  };
}
