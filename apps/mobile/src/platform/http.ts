import {
  ApiError,
  createDirectoryClient,
  createJsonRequester,
  createSessionClient,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import type { MobileConfig } from "../../config/environment";

export function createMobileApi(dependencies: {
  config: MobileConfig;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  newKey: () => string;
}) {
  const scope = createSessionScope();
  const request = createJsonRequester({
    scope,
    newKey: dependencies.newKey,
    transport: async (path, init) => {
      const response = await dependencies.fetch(
        new URL(path, dependencies.config.apiBaseUrl).href,
        {
          ...init,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        },
      );
      if (response.url && new URL(response.url).origin !== dependencies.config.apiBaseUrl)
        throw new ApiError(
          "UNAVAILABLE",
          "서버 연결을 확인하지 못했어요. 다시 시도해 주세요.",
          true,
        );
      return response;
    },
  });
  return {
    scope,
    directory: createDirectoryClient(request),
    session: createSessionClient(request, scope),
  };
}
export type MobileApi = ReturnType<typeof createMobileApi>;
