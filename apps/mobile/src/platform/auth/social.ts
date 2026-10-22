import { ApiError } from "@baro/api-client";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";
import type { MobileConfig } from "../../../config/environment";
import type { NativeCredentials } from "./credentials";
import type { createNativeLogin } from "./login";
import { createNativeTransport } from "./transport";

type Authorize = Parameters<typeof createNativeLogin>[0]["authorize"];
export function createNativeSocialAuthorization(dependencies: {
  config: MobileConfig;
  credentials: NativeCredentials;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Authorize {
  return async (input) => {
    try {
      await dependencies.credentials.ready();
      const frame = dependencies.credentials.capture();
      const transport = createNativeTransport({ ...dependencies, frame });
      const expo = expoClient({
        scheme: dependencies.config.scheme,
        storage: frame.storage,
        storagePrefix: dependencies.credentials.namespace,
        disableCache: true,
      });
      const manual = {
        ...expo,
        // The pinned SDK's automatic return handler expects a cookie URL. Our
        // one-use code protocol owns the browser and persistence instead.
        fetchPlugins: expo.fetchPlugins.map((plugin) => ({
          ...plugin,
          hooks: { ...plugin.hooks, onSuccess: async () => {} },
        })),
      };
      const client = createAuthClient({
        baseURL: `${dependencies.config.apiBaseUrl}/api/auth`,
        disableDefaultFetchPlugins: true,
        plugins: [manual],
        sessionOptions: {
          refetchInterval: 0,
          refetchOnWindowFocus: false,
          refetchWhenOffline: false,
        },
        fetchOptions: {
          retry: 0,
          customFetchImpl: async (input, init) =>
            transport(
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
              init ?? {},
            ),
        },
      });
      const result = await client.signIn.social({ ...input, disableRedirect: true });
      if (result.error || !result.data || typeof result.data.url !== "string")
        throw new Error("NATIVE_AUTH_START_FAILED");
      const cookie = await frame.cookie();
      const state = cookie
        .split(/;\s*/)
        .find(
          (entry) =>
            entry.startsWith("better-auth.oauth_state=") ||
            entry.startsWith("__Secure-better-auth.oauth_state="),
        );
      return {
        url: result.data.url,
        ...(state ? { oauthState: state.slice(state.indexOf("=") + 1) } : {}),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("UNAVAILABLE", "로그인을 시작하지 못했어요. 다시 시도해 주세요.", true);
    }
  };
}
