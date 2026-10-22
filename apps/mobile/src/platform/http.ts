import {
  ApiError,
  createDirectoryClient,
  createJsonRequester,
  createSessionClient,
  type HttpTransport,
} from "@baro/api-client";
import { createSessionScope, type SessionScope } from "@baro/client-core";
import type { MobileConfig } from "../../config/environment";

export function createMobileApi(dependencies: {
  config: MobileConfig;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  newKey: () => string;
  scope?: SessionScope;
  transport?: HttpTransport;
}) {
  const scope = dependencies.scope ?? createSessionScope();
  const anonymous: HttpTransport = async (path, init) => {
    const response = await dependencies.fetch(new URL(path, dependencies.config.apiBaseUrl).href, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (response.url && new URL(response.url).origin !== dependencies.config.apiBaseUrl)
      throw new ApiError("UNAVAILABLE", "서버 연결을 확인하지 못했어요. 다시 시도해 주세요.", true);
    return response;
  };
  const request = createJsonRequester({
    scope,
    newKey: dependencies.newKey,
    transport: dependencies.transport ?? anonymous,
  });
  // Public browsing remains available when the device's credential store is locked.
  const publicRequest = createJsonRequester({
    newKey: dependencies.newKey,
    transport: anonymous,
  });
  return {
    scope,
    request,
    directory: createDirectoryClient(publicRequest),
    session: createSessionClient(request, scope),
  };
}
export type MobileApi = ReturnType<typeof createMobileApi>;
