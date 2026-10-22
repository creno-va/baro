import type { SessionScope } from "@baro/client-core";
import type { MobileConfig } from "../../../config/environment";
import type { NativeCredentials } from "./credentials";

/** Revoke only the captured cookie; a late response must never refill a new jar. */
export async function signOutNative(dependencies: {
  config: MobileConfig;
  scope: SessionScope;
  credentials: NativeCredentials;
  cancelLogin: () => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<{ serverRevoked: boolean }> {
  dependencies.scope.invalidate();
  let cookie = "",
    readFailed = false;
  try {
    cookie = await dependencies.credentials.capture().cookie();
  } catch {
    readFailed = true;
  }
  // Cancel increments the auth-operation version and durably clears this jar.
  // Failed local clearing throws: it cannot be displayed as completed logout.
  await dependencies.cancelLogin();
  if (readFailed) return { serverRevoked: false };
  if (!cookie) return { serverRevoked: true };
  try {
    const response = await dependencies.fetch(
      `${dependencies.config.apiBaseUrl}/api/auth/sign-out`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: {
          cookie,
          origin: dependencies.config.apiBaseUrl,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    let sameOrigin = !response.redirected;
    try {
      sameOrigin &&=
        !response.url || new URL(response.url).origin === dependencies.config.apiBaseUrl;
    } catch {
      sameOrigin = false;
    }
    await response.body?.cancel().catch(() => {});
    return { serverRevoked: response.ok && sameOrigin };
  } catch {
    return { serverRevoked: false };
  }
}
