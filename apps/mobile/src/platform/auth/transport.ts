import { ApiError, type HttpTransport } from "@baro/api-client";
import type { MobileConfig } from "../../../config/environment";
import type { NativeCredentialFrame, NativeCredentials } from "./credentials";

const denied = () => new ApiError("UNAVAILABLE", "안전한 서버 연결을 확인하지 못했어요.", true);

export function withoutSetCookie(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  // Expo's native fetch supports streams, while RN's global Response constructor
  // does not accept a ReadableStream. Keep the original IO and native receiver.
  return new Proxy(response, {
    get(target, key) {
      if (key === "headers") return headers;
      if (key === "clone") return () => withoutSetCookie(target.clone());
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** One cookie writer for Hono and Better Auth; native fetch never owns a second jar. */
export function createNativeTransport(dependencies: {
  config: MobileConfig;
  credentials: NativeCredentials;
  frame?: NativeCredentialFrame;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
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
      url.hash ||
      !url.pathname.startsWith("/api/")
    )
      throw denied();
    const frame = dependencies.frame ?? dependencies.credentials.capture();
    const cookie = await frame.cookie();
    init.signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    headers.set("origin", dependencies.config.apiBaseUrl);
    if (cookie) headers.set("cookie", cookie);
    const response = await dependencies.fetch(url.href, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    try {
      let sameOrigin = !response.redirected;
      try {
        sameOrigin &&= !response.url || new URL(response.url).origin === url.origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) throw denied();
      init.signal?.throwIfAborted();
      // Error/expired-session responses can clear cookies too. Never let an old
      // response refresh a new owner's credentials, even when fetch ignores abort.
      await frame.accept(response.headers.get("set-cookie"));
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    // The Expo SDK must not write the same cookies again in its success hook.
    // Its public storage/codec remains shared; disable its session cache and use
    // sign-in with disableRedirect. Logout uses this transport before reset.
    return withoutSetCookie(response);
  };
}
