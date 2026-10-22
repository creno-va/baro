import { expo } from "@better-auth/expo";
import { createAuthMiddleware } from "better-auth/api";
import { mobileAuthStartSchema } from "../../contracts/mobile-auth";
import { createNativeAuthCodeStore } from "./native-codes";
import { createNativeReauthentication } from "./native-reauth";

export function nativeAuthCallbackBase(environment: string): string | null {
  const scheme = { local: "baro-dev", preview: "baro-preview", production: "baro" }[environment];
  return scheme ? `${scheme}://auth/callback` : null;
}
const providerOrigins = new Map([
  ["https://accounts.google.com/o/oauth2/v2/auth", "google"],
  ["https://nid.naver.com/oauth2.0/authorize", "naver"],
  ["https://kauth.kakao.com/oauth/authorize", "kakao"],
]);
function validAuthorizationProxy(request: Request, baseURL: string): boolean {
  try {
    const incoming = new URL(request.url);
    if (incoming.searchParams.getAll("authorizationURL").length !== 1) return false;
    const url = new URL(incoming.searchParams.get("authorizationURL") ?? "");
    if (
      url.searchParams.getAll("redirect_uri").length !== 1 ||
      url.searchParams.getAll("state").length !== 1
    )
      return false;
    if (url.username || url.password || url.hash || !url.searchParams.get("state")) return false;
    const provider = providerOrigins.get(`${url.origin}${url.pathname}`);
    return Boolean(
      provider &&
        url.searchParams.get("redirect_uri") ===
          `${baseURL.replace(/\/$/, "")}/api/auth/callback/${provider}`,
    );
  } catch {
    return false;
  }
}

/** Preserve the SDK's browser-state proxy; replace cookie-in-URL delivery with one-use PKCE grants. */
export function createNativeExpoIntegration(env: Env) {
  const sdk = expo({ disableOriginOverride: true });
  const callbackBase = nativeAuthCallbackBase(env.APP_ENV);
  return {
    ...sdk,
    // Expo Go is not an authentication target; only our configured development builds are trusted.
    init: () => ({ options: { trustedOrigins: [] as string[] } }),
    onRequest: async (request: Request) => {
      if (
        new URL(request.url).pathname.endsWith("/expo-authorization-proxy") &&
        !validAuthorizationProxy(request, env.BETTER_AUTH_URL)
      )
        return {
          response: Response.json(
            {
              error: { code: "INVALID_AUTHORIZATION_URL", message: "로그인을 다시 시작해 주세요." },
            },
            { status: 400, headers: { "cache-control": "no-store" } },
          ),
        };
      return undefined;
    },
    hooks: {
      after: [
        {
          matcher: (context: { path?: string | undefined }) =>
            Boolean(
              context.path?.startsWith("/callback") ||
                context.path?.startsWith("/magic-link/verify") ||
                context.path?.startsWith("/verify-email"),
            ),
          handler: createAuthMiddleware(async (ctx) => {
            const location = ctx.context.responseHeaders?.get("location");
            if (!callbackBase || !location) return;
            let target: URL;
            try {
              target = new URL(location);
            } catch {
              return;
            }
            const expected = new URL(callbackBase);
            if (target.protocol !== expected.protocol) return;
            const failure = new URL(callbackBase);
            failure.searchParams.set("error", "oauth");
            try {
              if (
                target.origin !== expected.origin ||
                target.hostname !== expected.hostname ||
                target.pathname !== expected.pathname ||
                target.username ||
                target.password ||
                target.port ||
                target.hash
              )
                throw new Error("NATIVE_AUTH_CALLBACK_INVALID");
              const parsed = mobileAuthStartSchema.parse({
                attemptId: target.searchParams.get("attemptId"),
                challenge: target.searchParams.get("challenge"),
                ...(target.searchParams.has("purpose")
                  ? { purpose: target.searchParams.get("purpose") }
                  : {}),
              });
              if (
                target.searchParams.getAll("attemptId").length !== 1 ||
                target.searchParams.getAll("challenge").length !== 1 ||
                target.searchParams.getAll("purpose").length > 1
              )
                throw new Error("NATIVE_AUTH_CALLBACK_INVALID");
              failure.searchParams.set("attemptId", parsed.attemptId);
              const session = ctx.context.newSession;
              const cookie = ctx.context.responseHeaders?.get("set-cookie");
              if (!session || !cookie || target.searchParams.has("error"))
                throw new Error("NATIVE_AUTH_CALLBACK_FAILED");
              const reauthentication =
                parsed.purpose === "reauthenticate"
                  ? await createNativeReauthentication({
                      db: env.DB,
                      issuer: env.BETTER_AUTH_URL,
                      secret: env.BETTER_AUTH_SECRET,
                    }).authorize(parsed, typeof ctx.params?.id === "string" ? ctx.params.id : "", {
                      sessionId: session.session.id,
                      userId: session.user.id,
                    })
                  : undefined;
              const result = await createNativeAuthCodeStore({
                db: env.DB,
                issuer: env.BETTER_AUTH_URL,
                secret: env.BETTER_AUTH_SECRET,
              }).issue({
                ...parsed,
                sessionId: session.session.id,
                userId: session.user.id,
                cookie,
                ...(reauthentication
                  ? { originalSessionId: reauthentication.originalSessionId }
                  : {}),
              });
              const redirect = new URL(callbackBase);
              redirect.searchParams.set("attemptId", result.attemptId);
              redirect.searchParams.set("code", result.code);
              ctx.setHeader("location", redirect.href);
            } catch {
              // No raw provider/SQL error, cookie or input URL enters diagnostics or the failure return.
              ctx.setHeader("location", failure.href);
            }
          }),
        },
      ],
    },
  };
}
